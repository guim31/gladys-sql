// -----------------------------------------------------------------------------
// The SQL queries followed as features of the database device, added and
// removed with the configuration actions "Add a query" and "Remove a query"
// (Gladys has no list field in a configuration form), stored under /data
// (src/store.js).
//
// A query = a name (its identity: the feature external id is derived from
// it), a SELECT, the column to read in the first row (empty: the first
// column), a type (number with or without unit, text, yes/no) and an interval
// (empty: the one of the configuration).
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import {
  DEVICE_FEATURE_CATEGORIES as CATEGORY,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
} from '@gladysassistant/integration-sdk';

// Gladys accepts 300 states per minute, and a device of 50 features helps nobody.
export const MAX_QUERIES = 20;
export const MAX_NAME_LENGTH = 60;
export const MAX_QUERY_LENGTH = 4000;
export const MAX_COLUMN_LENGTH = 64;
// A text state longer than this is cut (a dashboard shows a line).
export const MAX_TEXT_LENGTH = 250;

// Intervals offered in "Add a query", in seconds (empty: the configuration).
export const QUERY_INTERVALS = ['30', '60', '300', '900', '3600'];

const BIG = 1e12;

// The types offered in "Add a query": keys stored under /data and in the
// feature external ids, permanent once published. Bounds are display bounds.
export const QUERY_TYPES = Object.freeze({
  number: {
    kind: 'number',
    category: CATEGORY.UNKNOWN,
    type: TYPE.UNKNOWN.UNKNOWN,
    min: -BIG,
    max: BIG,
  },
  temperature: {
    kind: 'number',
    category: CATEGORY.TEMPERATURE_SENSOR,
    type: TYPE.SENSOR.DECIMAL,
    unit: UNIT.CELSIUS,
    min: -100,
    max: 200,
  },
  humidity: {
    kind: 'number',
    category: CATEGORY.HUMIDITY_SENSOR,
    type: TYPE.SENSOR.DECIMAL,
    unit: UNIT.PERCENT,
    min: 0,
    max: 100,
  },
  percent: {
    kind: 'number',
    category: CATEGORY.LEVEL_SENSOR,
    type: TYPE.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
    unit: UNIT.PERCENT,
    min: 0,
    max: 100,
  },
  power: {
    kind: 'number',
    category: CATEGORY.ENERGY_SENSOR,
    type: TYPE.ENERGY_SENSOR.POWER,
    unit: UNIT.WATT,
    // Signed: a solar inverter exports.
    min: -1e6,
    max: 1e6,
  },
  energy: {
    kind: 'number',
    category: CATEGORY.ENERGY_SENSOR,
    type: TYPE.ENERGY_SENSOR.ENERGY,
    unit: UNIT.KILOWATT_HOUR,
    min: 0,
    max: BIG,
  },
  size: {
    kind: 'number',
    category: CATEGORY.DATA,
    type: TYPE.DATA.SIZE,
    unit: UNIT.MEGABYTE,
    min: 0,
    max: BIG,
  },
  text: { kind: 'text', category: CATEGORY.TEXT, type: TYPE.TEXT.TEXT, min: 0, max: 0 },
  boolean: { kind: 'boolean', category: CATEGORY.INPUT, type: TYPE.SENSOR.BINARY, min: 0, max: 1 },
});

export const QUERY_TYPE_KEYS = Object.keys(QUERY_TYPES);

/** The id of a query: its name, case and spaces aside, hashed. */
export const queryId = (name) =>
  createHash('sha256')
    .update(name.trim().replace(/\s+/g, ' ').toLowerCase())
    .digest('hex')
    .slice(0, 12);

export const VALUE_ERRORS = Object.freeze({
  COLUMN: 'column',
  NOT_NUMBER: 'not_number',
  NOT_BOOLEAN: 'not_boolean',
});

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const TRUE = new Set(['1', 't', 'true', 'y', 'yes', 'on']);
const FALSE = new Set(['0', 'f', 'false', 'n', 'no', 'off']);

/** A cell as a number, or undefined when it is not one. */
function asNumber(cell) {
  if (typeof cell === 'number') {
    return Number.isFinite(cell) ? cell : undefined;
  }
  if (typeof cell === 'bigint') {
    return Number(cell);
  }
  if (typeof cell === 'boolean') {
    return cell ? 1 : 0;
  }
  if (typeof cell === 'string' && NUMBER.test(cell.trim())) {
    const number = Number(cell.trim());
    return Number.isFinite(number) ? number : undefined;
  }
  return undefined;
}

function asText(cell) {
  if (cell instanceof Date) {
    return Number.isNaN(cell.getTime()) ? '' : cell.toISOString();
  }
  if (Buffer.isBuffer(cell)) {
    return cell.toString('utf8');
  }
  if (typeof cell === 'object') {
    return JSON.stringify(cell);
  }
  return String(cell);
}

/**
 * The value of a query result for its type: first row, chosen column.
 * @param {{ rows: object[], columns: string[] }} result
 * @param {string} column '' for the first column
 * @param {string} type QUERY_TYPES key
 * @returns {{ value: number|string|null, error?: string }} value null: no row, or NULL
 */
export function extractValue(result, column, type) {
  const columns = result?.columns ?? [];
  let name = column ? columns.find((entry) => entry === column) : columns[0];
  // PostgreSQL folds unquoted names to lower case, MySQL keeps them.
  name ??= column
    ? columns.find((entry) => entry.toLowerCase() === column.toLowerCase())
    : undefined;
  if (name === undefined) {
    return { value: null, error: VALUE_ERRORS.COLUMN };
  }
  const row = result.rows?.[0];
  const cell = row?.[name];
  if (cell === null || cell === undefined) {
    return { value: null };
  }
  const { kind } = QUERY_TYPES[type];
  if (kind === 'text') {
    const text = asText(cell).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
    return { value: text || null };
  }
  if (kind === 'boolean') {
    const number = asNumber(cell);
    if (number !== undefined) {
      return { value: number === 0 ? 0 : 1 };
    }
    const word = asText(cell).trim().toLowerCase();
    if (TRUE.has(word) || FALSE.has(word)) {
      return { value: TRUE.has(word) ? 1 : 0 };
    }
    return { value: null, error: VALUE_ERRORS.NOT_BOOLEAN };
  }
  const number = asNumber(cell);
  if (number === undefined) {
    return { value: null, error: VALUE_ERRORS.NOT_NUMBER };
  }
  // Two decimals: enough for a dashboard, and fewer states for a noisy value.
  return { value: Math.round(number * 100) / 100 };
}

export const QUERY_ERRORS = Object.freeze({
  NAME: 'name',
  QUERY: 'query',
  COLUMN: 'column',
  TYPE: 'type',
  INTERVAL: 'interval',
});

/**
 * The fields of "Add a query", checked (the SQL itself is checked by the
 * guard, src/sql/guard.js).
 * @returns {{ query?: object, error?: string }}
 */
export function parseQueryFields(fields = {}) {
  const text = (key) =>
    typeof fields[key] === 'string' ? fields[key].trim().replace(/\s+/g, ' ') : '';
  const name = text('name');
  if (!name || name.length > MAX_NAME_LENGTH) {
    return { error: QUERY_ERRORS.NAME };
  }
  const query = typeof fields.query === 'string' ? fields.query.trim() : '';
  if (!query || query.length > MAX_QUERY_LENGTH) {
    return { error: QUERY_ERRORS.QUERY };
  }
  const column = text('column');
  if (column.length > MAX_COLUMN_LENGTH) {
    return { error: QUERY_ERRORS.COLUMN };
  }
  const type = typeof fields.type === 'string' && fields.type ? fields.type : 'number';
  if (!QUERY_TYPE_KEYS.includes(type)) {
    return { error: QUERY_ERRORS.TYPE };
  }
  const interval =
    fields.interval === undefined || fields.interval === null || fields.interval === ''
      ? ''
      : String(fields.interval);
  if (interval && !QUERY_INTERVALS.includes(interval)) {
    return { error: QUERY_ERRORS.INTERVAL };
  }
  return { query: { id: queryId(name), name, query, column, type, interval } };
}

/** A query read back from /data, or null when it is not one. */
export function restoreQuery(saved) {
  if (!saved || typeof saved !== 'object') {
    return null;
  }
  const { query } = parseQueryFields(saved);
  return query && query.id === saved.id ? query : null;
}

/** The interval of a query, in ms. */
export const intervalOf = (query, config) =>
  query.interval ? Number(query.interval) * 1000 : config.pollIntervalMs;
