// -----------------------------------------------------------------------------
// Read-only guard: the integration refuses any text that is not a single
// SELECT (or WITH … SELECT) before it reaches the database. The database
// enforces it a second time: every query runs in a read-only transaction
// (src/sql/client.js), and the documentation asks for a user who may only read.
//
// The text is scanned the way the server reads it: string literals, quoted
// identifiers, comments and (PostgreSQL) dollar quotes are blanked out, so a
// `;` or a keyword inside them is not code, and one outside them cannot hide
// inside something the scanner took for a literal. Anything the scanner is
// not sure of (an unterminated literal, a MySQL executable comment `/*! … */`,
// a backslash, whose meaning depends on server settings) is refused.
// -----------------------------------------------------------------------------

export const GUARD_ERRORS = Object.freeze({
  EMPTY: 'empty',
  NOT_SELECT: 'not_select',
  MULTIPLE: 'multiple',
  FORBIDDEN: 'forbidden',
  UNTERMINATED: 'unterminated',
  BACKSLASH: 'backslash',
});

// Words that write, lock, or reach outside the database, even inside a
// SELECT: data-modifying CTEs (PostgreSQL), SELECT … INTO (a new table, or a
// file with MySQL), FOR UPDATE / FOR SHARE locks, and the functions that act
// on the server rather than read data — some of them escape the read-only
// transaction (a file read or written, another session through dblink, a
// backend stopped). A name ending in `*` covers the family (`\w` includes
// `_`: `dblink` alone would let `dblink_connect` through).
const FORBIDDEN_WORDS = [
  'insert',
  'update',
  'delete',
  'merge',
  'into',
  'outfile',
  'dumpfile',
  'share',
  'lock',
  'nextval',
  'setval',
  'set_config',
  'dblink*',
  'lo_*',
  'pg_advisory*',
  'pg_try_advisory*',
  'pg_cancel_backend',
  'pg_terminate_backend',
  'pg_reload_conf',
  'pg_rotate_logfile',
  'pg_read*',
  'pg_file_*',
  'pg_ls_*',
  'pg_stat_file',
  'pg_stat_reset*',
  'pg_logdir_ls',
  'pg_log_*',
  'pg_switch_wal',
  'pg_create_*',
  'pg_drop_*',
  'pg_replication_*',
  'pg_promote',
  'pg_notify',
  'load_file',
  'get_lock',
  'release_lock',
  'release_all_locks',
  'benchmark',
  'sys_exec',
  'sys_eval',
];
const FORBIDDEN = new RegExp(
  `\\b(${FORBIDDEN_WORDS.map((word) => word.replace('*', '\\w*')).join('|')})\\b`,
  'i',
);

// Characters of an unquoted identifier: PostgreSQL accepts any non-ASCII
// letter, and `$` after the first character.
const IDENTIFIER = /[A-Za-z0-9_$\u0080-￿]/;
const DOLLAR_TAG = /^\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/;

// MySQL ends a "-- " comment on any space or control character after "--".
const endsDashes = (char) => char === undefined || char.charCodeAt(0) <= 0x20;

/**
 * The code of `text` with every literal, quoted identifier and comment
 * replaced by spaces (same length: positions are kept).
 * @param {string} text
 * @param {'postgres'|'mysql'} engine
 * @returns {string|null} null when a literal or comment is not terminated
 */
export function blankLiterals(text, engine) {
  // UTF-16 units, as the indices below (not code points).
  const out = text.split('');
  const blank = (from, to) => {
    for (let at = from; at < to; at += 1) {
      out[at] = out[at] === '\n' ? '\n' : ' ';
    }
  };
  const mysql = engine === 'mysql';
  let at = 0;
  while (at < text.length) {
    const char = text[at];
    const next = text[at + 1];
    // Line comments: MySQL needs a space (or control) after "--".
    if (
      (char === '-' && next === '-' && (!mysql || endsDashes(text[at + 2]))) ||
      (mysql && char === '#')
    ) {
      const end = text.indexOf('\n', at);
      const stop = end === -1 ? text.length : end;
      blank(at, stop);
      at = stop;
      continue;
    }
    if (char === '/' && next === '*') {
      // MySQL and MariaDB run the content of /*! … */ and /*M! … */.
      if (mysql && /^\/\*M?!/.test(text.slice(at, at + 4))) {
        return null;
      }
      // PostgreSQL nests block comments, MySQL does not.
      let depth = 1;
      let cursor = at + 2;
      while (cursor < text.length && depth > 0) {
        if (!mysql && text[cursor] === '/' && text[cursor + 1] === '*') {
          depth += 1;
          cursor += 2;
        } else if (text[cursor] === '*' && text[cursor + 1] === '/') {
          depth -= 1;
          cursor += 2;
        } else {
          cursor += 1;
        }
      }
      if (depth > 0) {
        return null;
      }
      blank(at, cursor);
      at = cursor;
      continue;
    }
    // PostgreSQL dollar quotes: $$ … $$ or $tag$ … $tag$ (not $1, a parameter).
    if (!mysql && char === '$') {
      const tag = text.slice(at).match(DOLLAR_TAG)?.[0];
      const previous = text[at - 1];
      if (tag && !(previous && IDENTIFIER.test(previous))) {
        const end = text.indexOf(tag, at + tag.length);
        if (end === -1) {
          return null;
        }
        blank(at, end + tag.length);
        at = end + tag.length;
        continue;
      }
    }
    const quoted = char === "'" || char === '"' || (mysql && char === '`');
    if (quoted) {
      let cursor = at + 1;
      let closed = false;
      while (cursor < text.length) {
        const current = text[cursor];
        if (current === char) {
          if (text[cursor + 1] === char) {
            cursor += 2; // doubled quote
            continue;
          }
          closed = true;
          break;
        }
        cursor += 1;
      }
      if (!closed) {
        return null;
      }
      blank(at, cursor + 1);
      at = cursor + 1;
      continue;
    }
    at += 1;
  }
  return out.join('');
}

/**
 * Check that `text` is a single read-only SELECT.
 * @param {string} text
 * @param {'postgres'|'mysql'} engine
 * @returns {{ sql: string, error?: undefined }|{ error: string, word?: string }}
 *   `sql`: the text without its trailing semicolon
 */
export function checkReadOnly(text, engine) {
  const source = typeof text === 'string' ? text : '';
  // A backslash escapes a quote or not depending on server settings
  // (NO_BACKSLASH_ESCAPES, standard_conforming_strings, E'…'): the guard could
  // not know where a literal ends. Refused anywhere.
  if (source.includes('\\')) {
    return { error: GUARD_ERRORS.BACKSLASH };
  }
  const code = blankLiterals(source, engine);
  if (code === null) {
    return { error: GUARD_ERRORS.UNTERMINATED };
  }
  if (!code.trim()) {
    return { error: GUARD_ERRORS.EMPTY };
  }
  // A literal or a comment at the end is blank in `code`: only a trailing
  // semicolon of the code is cut.
  const last = code.trimEnd().length - 1;
  const end = code[last] === ';' ? last : source.length;
  const body = code.slice(0, end);
  if (body.includes(';')) {
    return { error: GUARD_ERRORS.MULTIPLE };
  }
  const first = body
    .trimStart()
    .replace(/^\(+\s*/, '')
    .match(/^[A-Za-z]+/)?.[0]
    ?.toLowerCase();
  if (first !== 'select' && first !== 'with') {
    return { error: GUARD_ERRORS.NOT_SELECT };
  }
  const word = body.match(FORBIDDEN)?.[1];
  if (word) {
    return { error: GUARD_ERRORS.FORBIDDEN, word: word.toUpperCase() };
  }
  return { sql: source.slice(0, end).trim() };
}
