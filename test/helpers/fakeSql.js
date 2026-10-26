// -----------------------------------------------------------------------------
// A fake database behind the `pg` and `mysql2` driver calls (src/sql/client.js
// DRIVERS), replaying the real answers recorded from PostgreSQL 17, MariaDB 11
// and MySQL 8 (test/fixtures/real, anonymized): rows as the drivers give
// them, real error codes and messages. It records every statement, so the
// tests can check the read-only transaction around each query.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const load = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/real/${name}.json`, import.meta.url), 'utf8'));

export const FIXTURES = {
  postgres: load('postgres-17'),
  mariadb: load('mariadb-11'),
  mysql: load('mysql-8'),
};

// The engine (configuration value) of each recorded server.
export const ENGINE_OF = { postgres: 'postgres', mariadb: 'mysql', mysql: 'mysql' };

const CONTROL = /^(BEGIN READ ONLY|ROLLBACK|START TRANSACTION READ ONLY|SET (LOCAL|SESSION) .*)$/i;

const errorOf = (recorded) => Object.assign(new Error(recorded.message), recorded);

export class FakeSql {
  /** @param {'postgres'|'mariadb'|'mysql'} server a recorded server */
  constructor(server = 'postgres') {
    this.server = server;
    this.fixture = FIXTURES[server];
    /** Answers by SQL text: the recorded ones, and the ones a test adds. */
    this.answers = new Map(Object.values(this.fixture.queries).map((entry) => [entry.sql, entry]));
    /** null, or a recorded connect error key: 'refused', 'auth', 'database'. */
    this.failure = null;
    /** Every statement, in order, and the options of every connection. */
    this.statements = [];
    this.connections = [];
    /** The protocol of each PostgreSQL statement ('extended' or simple). */
    this.modes = new Map();
    this.open = 0;
  }

  /** A query of the recorded set, by key ('last', 'avg', 'syntax'…). */
  sql(key) {
    return this.fixture.queries[key].sql;
  }

  answer(sql) {
    this.statements.push(sql);
    if (/^SELECT version\(\) AS v$/i.test(sql)) {
      return { rows: [{ v: this.fixture.version }], columns: ['v'] };
    }
    if (CONTROL.test(sql)) {
      return { rows: [], columns: [] };
    }
    const entry = this.answers.get(sql);
    if (!entry) {
      throw errorOf(this.fixture.queries.notable.error);
    }
    if (entry.error) {
      throw errorOf(entry.error);
    }
    return { rows: structuredClone(entry.rows), columns: entry.columns };
  }

  connectFailure() {
    if (!this.failure) {
      return null;
    }
    return errorOf(this.fixture.connectErrors[this.failure]);
  }

  /** The DRIVERS seam of src/sql/client.js. */
  drivers() {
    return {
      postgres: (options) => {
        this.connections.push(options);
        let connected = false;
        return {
          on() {},
          connect: async () => {
            const failure = this.connectFailure();
            if (failure) {
              throw failure;
            }
            connected = true;
            this.open += 1;
          },
          query: async (query) => {
            const text = typeof query === 'string' ? query : query.text;
            this.modes.set(text, query.queryMode);
            const { rows, columns } = this.answer(text);
            return { rows, fields: columns.map((name) => ({ name })) };
          },
          end: async () => {
            if (connected) {
              connected = false;
              this.open -= 1;
            }
          },
        };
      },
      mysql: async (options) => {
        this.connections.push(options);
        const failure = this.connectFailure();
        if (failure) {
          throw failure;
        }
        this.open += 1;
        return {
          on() {},
          query: async (query) => {
            const { rows, columns } = this.answer(typeof query === 'string' ? query : query.sql);
            return [rows, columns.length ? columns.map((name) => ({ name })) : undefined];
          },
          end: async () => {
            this.open -= 1;
          },
          destroy: () => {
            this.open -= 1;
          },
        };
      },
    };
  }
}
