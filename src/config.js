// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One database: PostgreSQL, or MariaDB / MySQL. The queries are not
// configuration fields (Gladys has no list field): the "Add a query" action
// stores them under /data, see src/queries.js.
// -----------------------------------------------------------------------------

import { DEFAULT_PORTS, ENGINES, TLS_MODES } from './sql/client.js';

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['30', '60', '120', '300', '600', '1800', '3600'];
// Time limits of one query offered in the configuration, in seconds.
export const QUERY_TIMEOUTS = ['5', '10', '30', '60'];

export const DEFAULT_CONFIG = {
  engine: 'postgres',
  host: '',
  port: null,
  database: '',
  username: '',
  password: '',
  tls: 'off',
  poll_interval: '60',
  query_timeout: '10',
  language: 'fr',
};

// A host name or an address, without scheme, port or credentials.
const HOST =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?)*|\[?[0-9A-Fa-f:.]+\]?)$/;

/**
 * The host typed by the user: "192.0.2.5", "db.home.lan", or with a port
 * ("192.0.2.5:5433", which wins over an empty port field). A scheme
 * (postgres://) is dropped.
 * @returns {{ host: string, port: number|null }|null} null when unusable
 */
export function parseHost(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  let text = raw
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/\/.*$/, '');
  if (!text) {
    return null;
  }
  // Credentials in the host would end up in the logs: there are fields.
  if (text.includes('@')) {
    return null;
  }
  let port = null;
  const withPort = text.match(/^(\[[0-9A-Fa-f:.]+\]|[^:]+):(\d{1,5})$/);
  if (withPort) {
    text = withPort[1];
    port = Number(withPort[2]);
  }
  if (!HOST.test(text) || (port !== null && (port < 1 || port > 65535))) {
    return null;
  }
  return { host: text.replace(/^\[(.*)\]$/, '$1'), port };
}

const portOf = (value) => {
  const port = Number(typeof value === 'string' ? value.trim() : value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
};

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };
  const engine = pick('engine', Object.values(ENGINES));
  const typed = text('host');
  const parsed = parseHost(typed);
  return {
    engine,
    host: parsed?.host ?? null,
    invalidHost: Boolean(typed) && !parsed,
    port: portOf(source.port) ?? parsed?.port ?? DEFAULT_PORTS[engine],
    database: text('database'),
    username: text('username'),
    // A password may start or end with a space: kept as typed.
    password: typeof source.password === 'string' ? source.password : '',
    tls: pick('tls', TLS_MODES),
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    timeoutMs: Number(pick('query_timeout', QUERY_TIMEOUTS)) * 1000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}

/** "192.0.2.5:5432/home", for the logs and the messages (no user, no password). */
export const placeOf = (config) =>
  `${config.host?.includes(':') ? `[${config.host}]` : config.host}:${config.port}/${config.database}`;

/** The configuration fields still missing: a CONNECTION_TEXT key, or null. */
export function missingField(config) {
  if (config.invalidHost) {
    return 'invalidHost';
  }
  if (!config.host) {
    return 'noHost';
  }
  if (!config.database) {
    return 'noDatabase';
  }
  if (!config.username) {
    return 'noUser';
  }
  return null;
}
