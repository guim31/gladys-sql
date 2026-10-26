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
// not sure of (an unterminated literal, a MySQL executable comment `/*! … */`)
// is refused.
// -----------------------------------------------------------------------------

export const GUARD_ERRORS = Object.freeze({
  EMPTY: 'empty',
  NOT_SELECT: 'not_select',
  MULTIPLE: 'multiple',
  FORBIDDEN: 'forbidden',
  UNTERMINATED: 'unterminated',
});

// Words that write, lock, or reach outside the database, even inside a
// SELECT: data-modifying CTEs (PostgreSQL), SELECT … INTO (a new table, or a
// file with MySQL), FOR UPDATE / FOR SHARE locks, and the functions that act
// on the server rather than read data.
const FORBIDDEN = new RegExp(
  `\\b(${[
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
    'pg_terminate_backend',
    'pg_cancel_backend',
    'pg_reload_conf',
    'pg_rotate_logfile',
    'pg_read_file',
    'pg_read_binary_file',
    'pg_ls_dir',
    'pg_advisory_lock',
    'pg_advisory_xact_lock',
    'lo_import',
    'lo_export',
    'lo_unlink',
    'dblink',
    'dblink_exec',
    'load_file',
    'get_lock',
    'release_lock',
    'benchmark',
  ].join('|')})\\b`,
  'i',
);

const isSpace = (char) => char === ' ' || char === '\t' || char === '\n' || char === '\r';

/**
 * The code of `text` with every literal, quoted identifier and comment
 * replaced by spaces (same length: positions are kept).
 * @param {string} text
 * @param {'postgres'|'mysql'} engine
 * @returns {string|null} null when a literal or comment is not terminated
 */
export function blankLiterals(text, engine) {
  const out = [...text];
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
      (char === '-' &&
        next === '-' &&
        (!mysql || at + 2 >= text.length || isSpace(text[at + 2]))) ||
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
      const tag = text.slice(at).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      const previous = text[at - 1];
      if (tag && !(previous && /[A-Za-z0-9_]/.test(previous))) {
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
      // Backslash escapes: always in MySQL strings, in PostgreSQL E'…' only.
      const escapes = mysql
        ? char !== '`'
        : char === "'" &&
          /[eE]/.test(text[at - 1] ?? '') &&
          !/[A-Za-z0-9_]/.test(text[at - 2] ?? '');
      let cursor = at + 1;
      let closed = false;
      while (cursor < text.length) {
        const current = text[cursor];
        if (escapes && current === '\\') {
          cursor += 2;
          continue;
        }
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
