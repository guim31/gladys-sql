// -----------------------------------------------------------------------------
// SQL client: PostgreSQL (`pg`) and MariaDB / MySQL (`mysql2`), one short
// connection per read, closed right after (a home database, read every few
// minutes, does not need a pool: nothing stays open between reads).
//
// Every query goes through the guard (src/sql/guard.js), then runs in a
// read-only transaction, rolled back, with a time limit on the server and on
// the client:
//   - PostgreSQL: the session itself is read-only (default_transaction_read_only),
//     BEGIN READ ONLY, statement_timeout, and the extended protocol, which
//     refuses a second statement;
//   - MariaDB / MySQL: SET SESSION TRANSACTION READ ONLY, START TRANSACTION
//     READ ONLY, max_statement_time (MariaDB) or max_execution_time (MySQL),
//     and mysql2 without multipleStatements.
//
// Errors are sorted into kinds (ERROR_KINDS): the server ones (no answer,
// TLS, access, database) make the database unreachable; the others belong to
// one query.
// -----------------------------------------------------------------------------

import mysql from 'mysql2/promise';
import pg from 'pg';
import { checkReadOnly } from './guard.js';

export const ENGINES = Object.freeze({ POSTGRES: 'postgres', MYSQL: 'mysql' });
export const DEFAULT_PORTS = Object.freeze({ postgres: 5432, mysql: 3306 });
export const TLS_MODES = Object.freeze(['off', 'require', 'verify']);

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable',
  TLS: 'tls',
  AUTH: 'auth',
  DATABASE: 'database',
  TIMEOUT: 'timeout',
  READ_ONLY: 'read_only',
  REFUSED: 'refused', // the guard of the integration
  QUERY: 'query',
});

// Kinds that say the database cannot be read at all, whatever the query.
export const SERVER_ERRORS = new Set([
  ERROR_KINDS.UNREACHABLE,
  ERROR_KINDS.TLS,
  ERROR_KINDS.AUTH,
  ERROR_KINDS.DATABASE,
]);

export class SqlError extends Error {
  /**
   * @param {string} kind ERROR_KINDS
   * @param {string} message for the logs (never a password)
   * @param {string} [detail] what the server said, shown to the user
   */
  constructor(kind, message, detail) {
    super(message);
    this.kind = kind;
    this.detail = detail;
  }
}

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ECONNRESET',
  'EPIPE',
]);
const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'HANDSHAKE_NO_SSL_SUPPORT',
  'ERR_SSL_WRONG_VERSION_NUMBER',
]);
// PostgreSQL SQLSTATE codes.
const PG_KINDS = {
  '28P01': ERROR_KINDS.AUTH,
  28000: ERROR_KINDS.AUTH,
  '3D000': ERROR_KINDS.DATABASE,
  25006: ERROR_KINDS.READ_ONLY,
  57014: ERROR_KINDS.TIMEOUT,
  // The server cannot take the connection now: the database, not the query.
  53300: ERROR_KINDS.UNREACHABLE, // too many connections
  '57P01': ERROR_KINDS.UNREACHABLE, // shutting down
  '57P03': ERROR_KINDS.UNREACHABLE, // starting up
};
// MariaDB / MySQL error numbers.
const MYSQL_KINDS = {
  1044: ERROR_KINDS.DATABASE, // no such database, or no right on it
  1045: ERROR_KINDS.AUTH,
  1049: ERROR_KINDS.DATABASE,
  1792: ERROR_KINDS.READ_ONLY,
  1969: ERROR_KINDS.TIMEOUT, // MariaDB max_statement_time
  3024: ERROR_KINDS.TIMEOUT, // MySQL max_execution_time
  3159: ERROR_KINDS.TLS, // insecure transport refused
  1040: ERROR_KINDS.UNREACHABLE, // too many connections
  1203: ERROR_KINDS.UNREACHABLE, // max_user_connections
};

const oneLine = (text) =>
  String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

/** Any error of `pg` or `mysql2`, as a SqlError. */
export function classify(err) {
  if (err instanceof SqlError) {
    return err;
  }
  const code = err?.code;
  const message = oneLine(err?.message);
  if (typeof code === 'string' && NETWORK_CODES.has(code)) {
    return new SqlError(ERROR_KINDS.UNREACHABLE, `${code}`);
  }
  if (code === 'PROTOCOL_SEQUENCE_TIMEOUT' || /^Query read timeout$/i.test(message)) {
    return new SqlError(ERROR_KINDS.TIMEOUT, message);
  }
  // An answer of the server (SQLSTATE, error number) is read by its code
  // first: "column "certificate" does not exist" is not a TLS problem.
  const fromServer =
    Boolean(err?.sqlState) || (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code));
  if (!fromServer) {
    if (
      (typeof code === 'string' && TLS_CODES.has(code)) ||
      /\bSSL\b|\bTLS\b|certificate/i.test(message)
    ) {
      return new SqlError(ERROR_KINDS.TLS, message, message);
    }
    if (/timeout expired|connection timeout|Connection terminated/i.test(message)) {
      return new SqlError(ERROR_KINDS.UNREACHABLE, message);
    }
  }
  const kind = PG_KINDS[code] ?? MYSQL_KINDS[err?.errno];
  if (kind) {
    return new SqlError(kind, message, message);
  }
  if (fromServer) {
    return new SqlError(ERROR_KINDS.QUERY, message, message);
  }
  return new SqlError(ERROR_KINDS.UNREACHABLE, message || 'connection failed');
}

/** The guard refusing a text: `reason` is a GUARD_ERRORS value, `detail` the word. */
export const refusal = ({ error, word }) =>
  Object.assign(new SqlError(ERROR_KINDS.REFUSED, `refused: ${error}`, word ?? ''), {
    reason: error,
  });

/** "PostgreSQL 17.6","MariaDB 11.4.3", "MySQL 8.4.2". */
export function serverVersion(engine, raw) {
  const text = String(raw ?? '');
  if (engine === ENGINES.POSTGRES) {
    const version = text.match(/PostgreSQL\s+([0-9][0-9.]*\w*)/i)?.[1];
    return version ? `PostgreSQL ${version}` : oneLine(text).slice(0, 40);
  }
  const version = text.match(/^[0-9][0-9.]*/)?.[0] ?? oneLine(text).slice(0, 30);
  return /mariadb/i.test(text) ? `MariaDB ${version}` : `MySQL ${version}`;
}

/** The driver calls, so that the tests can replace them. */
export const DRIVERS = {
  postgres: (options) => new pg.Client(options),
  mysql: (options) => mysql.createConnection(options),
};

export class SqlClient {
  /**
   * @param {object} options
   * @param {'postgres'|'mysql'} options.engine
   * @param {string} options.host
   * @param {number} options.port
   * @param {string} options.database
   * @param {string} options.user
   * @param {string} options.password
   * @param {'off'|'require'|'verify'} options.tls
   * @param {number} options.timeoutMs time limit of one query
   * @param {object} [options.drivers] DRIVERS overrides (tests)
   */
  constructor({ engine, host, port, database, user, password, tls, timeoutMs, drivers }) {
    this.engine = engine;
    this.options = { host, port, database, user, password, tls };
    this.timeoutMs = timeoutMs;
    this.drivers = { ...DRIVERS, ...drivers };
  }

  /** Connected for one call of `fn(session)`, closed after. */
  async session(fn) {
    const session =
      this.engine === ENGINES.POSTGRES ? await this.openPostgres() : await this.openMysql();
    try {
      return await fn(session);
    } finally {
      await session.close();
    }
  }

  async openPostgres() {
    const { host, port, database, user, password, tls } = this.options;
    const client = this.drivers.postgres({
      host,
      port,
      database,
      user,
      password,
      ssl: tls === 'off' ? false : { rejectUnauthorized: tls === 'verify' },
      connectionTimeoutMillis: Math.max(5000, this.timeoutMs),
      statement_timeout: this.timeoutMs,
      // The client gives up a little after the server.
      query_timeout: this.timeoutMs + 2000,
      application_name: 'gladys-sql',
      // Every transaction of the session is read-only by default.
      options: '-c default_transaction_read_only=on',
    });
    // A connection lost after connect() emits 'error': without a listener,
    // Node stops the process.
    client.on?.('error', () => {});
    try {
      await client.connect();
    } catch (err) {
      await client.end?.().catch(() => {});
      throw classify(err);
    }
    const run = async (text) => {
      try {
        return await client.query({ text, queryMode: 'extended' });
      } catch (err) {
        throw classify(err);
      }
    };
    return {
      version: async () =>
        serverVersion(this.engine, (await run('SELECT version() AS v')).rows[0]?.v),
      query: async (text) => {
        await run('BEGIN READ ONLY');
        try {
          await run(`SET LOCAL statement_timeout = ${Math.round(this.timeoutMs)}`);
          const result = await run(text);
          return { rows: result.rows, columns: result.fields.map((field) => field.name) };
        } finally {
          await client.query('ROLLBACK').catch(() => {});
        }
      },
      // A server gone silent never acknowledges the end: the socket is
      // destroyed after two seconds.
      close: () =>
        Promise.race([
          client.end().catch(() => {}),
          new Promise((resolve) => {
            setTimeout(resolve, 2000).unref?.();
          }).then(() => client.connection?.stream?.destroy?.()),
        ]),
    };
  }

  async openMysql() {
    const { host, port, database, user, password, tls } = this.options;
    let connection;
    try {
      connection = await this.drivers.mysql({
        host,
        port,
        database,
        user,
        password,
        ssl: tls === 'off' ? undefined : { rejectUnauthorized: tls === 'verify' },
        connectTimeout: Math.max(5000, this.timeoutMs),
        multipleStatements: false,
        // DECIMAL and BIGINT as text: no precision lost, converted later.
        decimalNumbers: false,
        supportBigNumbers: true,
        bigNumberStrings: true,
        dateStrings: true,
        // A server that needs the RSA key of caching_sha2_password (MySQL 8
        // without TLS) sends it; nothing to configure.
      });
    } catch (err) {
      throw classify(err);
    }
    connection.on?.('error', () => {});
    // Every statement has a client time limit: a network gone silent after
    // the connection must not hold the read forever.
    const run = async (sql) => {
      try {
        const [rows, fields] = await connection.query({ sql, timeout: this.timeoutMs + 2000 });
        return { rows, fields };
      } catch (err) {
        throw classify(err);
      }
    };
    let version;
    try {
      version = String((await run('SELECT version() AS v')).rows[0]?.v ?? '');
      await run('SET SESSION TRANSACTION READ ONLY');
      // Server-side time limit: MariaDB counts in seconds, MySQL in ms.
      await (/mariadb/i.test(version)
        ? run(`SET SESSION max_statement_time = ${Math.max(1, Math.round(this.timeoutMs / 1000))}`)
        : run(`SET SESSION max_execution_time = ${Math.round(this.timeoutMs)}`));
    } catch (err) {
      connection.destroy();
      throw err;
    }
    return {
      version: async () => serverVersion(this.engine, version),
      query: async (text) => {
        await run('START TRANSACTION READ ONLY');
        try {
          const { rows, fields } = await run(text);
          return {
            rows: Array.isArray(rows) ? rows : [],
            columns: (fields ?? []).map((field) => field.name),
          };
        } finally {
          await run('ROLLBACK').catch(() => {});
        }
      },
      // Closed without waiting for the server (COM_QUIT needs no answer).
      close: async () => {
        connection.destroy();
      },
    };
  }

  /** The server version, read on a fresh connection. */
  version() {
    return this.session((session) => session.version());
  }

  /**
   * One query, refused before the database when it is not a single SELECT.
   * @returns {Promise<{ rows: object[], columns: string[] }>}
   */
  query(text) {
    const checked = checkReadOnly(text, this.engine);
    if (checked.error) {
      return Promise.reject(refusal(checked));
    }
    return this.session((session) => session.query(checked.sql));
  }
}
