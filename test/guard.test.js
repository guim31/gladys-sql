// -----------------------------------------------------------------------------
// The read-only guard: a single SELECT passes, anything that writes, locks,
// chains a second statement or hides code in a comment is refused, in the
// grammar of each engine (literals, comments, dollar quotes).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUARD_ERRORS as E, checkReadOnly } from '../src/sql/guard.js';

const both = ['postgres', 'mysql'];

test('a single SELECT or WITH … SELECT passes, without its trailing semicolon', () => {
  const cases = [
    ['SELECT 1', 'SELECT 1'],
    [
      '  select temperature from measures order by id desc limit 1 ;  ',
      'select temperature from measures order by id desc limit 1',
    ],
    [
      "SELECT count(*) FROM events WHERE kind = 'a;b'",
      "SELECT count(*) FROM events WHERE kind = 'a;b'",
    ],
    [
      "SELECT room FROM measures WHERE room = 'none'",
      "SELECT room FROM measures WHERE room = 'none'",
    ],
    ['WITH t AS (SELECT 1 AS x) SELECT x FROM t;', 'WITH t AS (SELECT 1 AS x) SELECT x FROM t'],
    ['(SELECT 1) UNION (SELECT 2)', '(SELECT 1) UNION (SELECT 2)'],
    ['SELECT 1 -- the last value', 'SELECT 1 -- the last value'],
    ["SELECT 'it''s' /* note; */", "SELECT 'it''s' /* note; */"],
    ['SELECT updated_at, deleted FROM t', 'SELECT updated_at, deleted FROM t'],
  ];
  for (const engine of both) {
    for (const [text, sql] of cases) {
      assert.deepEqual(checkReadOnly(text, engine), { sql }, `${engine}: ${text}`);
    }
  }
});

test('a quoted keyword or identifier is not code', () => {
  assert.ok(checkReadOnly('SELECT "update", "into" FROM "delete"', 'postgres').sql);
  assert.ok(checkReadOnly('SELECT `update` FROM `insert`', 'mysql').sql);
  assert.ok(checkReadOnly("SELECT 'DELETE FROM x; DROP TABLE y'", 'mysql').sql);
  assert.ok(checkReadOnly('SELECT $$DELETE; x$$, $tag$;$tag$', 'postgres').sql);
});

test('anything but a SELECT is refused', () => {
  for (const engine of both) {
    for (const text of [
      "INSERT INTO events (kind) VALUES ('x')",
      "UPDATE events SET kind = 'x'",
      'DELETE FROM events',
      'DROP TABLE events',
      'TRUNCATE events',
      'CREATE TABLE x (a int)',
      'CALL do_something()',
      'EXPLAIN ANALYZE SELECT 1',
      'SET ROLE admin',
      'VALUES (1)',
      'GRANT ALL ON events TO reader',
    ]) {
      assert.equal(checkReadOnly(text, engine).error, E.NOT_SELECT, `${engine}: ${text}`);
    }
    assert.equal(checkReadOnly('   ', engine).error, E.EMPTY);
    assert.equal(checkReadOnly(undefined, engine).error, E.EMPTY);
  }
});

test('a second statement is refused, however it hides', () => {
  for (const engine of both) {
    for (const text of [
      'SELECT 1; DROP TABLE events',
      'SELECT 1;; ',
      "SELECT 'a'; DELETE FROM events",
      'SELECT 1 /* x */; SELECT 2',
    ]) {
      assert.equal(checkReadOnly(text, engine).error, E.MULTIPLE, `${engine}: ${text}`);
    }
  }
  // A comment that ends the line, then a statement on the next.
  assert.equal(checkReadOnly('SELECT 1 -- x\n; DROP TABLE t', 'postgres').error, E.MULTIPLE);
  // MySQL needs a space after "--": "--1" is minus minus one, the ";" is code.
  assert.equal(checkReadOnly('SELECT 1 --1\n; DROP TABLE t', 'mysql').error, E.MULTIPLE);
  assert.equal(checkReadOnly('SELECT 1 # x\n; DROP TABLE t', 'mysql').error, E.MULTIPLE);
});

test('a SELECT that writes, locks or acts on the server is refused', () => {
  const cases = [
    ['postgres', 'WITH d AS (DELETE FROM events RETURNING *) SELECT count(*) FROM d', 'DELETE'],
    ['postgres', 'WITH u AS (UPDATE t SET a = 1 RETURNING a) SELECT * FROM u', 'UPDATE'],
    ['postgres', 'SELECT * INTO copy FROM events', 'INTO'],
    ['mysql', "SELECT * FROM events INTO OUTFILE '/tmp/x'", 'INTO'],
    ['postgres', 'SELECT * FROM events FOR UPDATE', 'UPDATE'],
    ['postgres', 'SELECT * FROM events FOR SHARE', 'SHARE'],
    ['mysql', 'SELECT * FROM events LOCK IN SHARE MODE', 'LOCK'],
    ['postgres', "SELECT nextval('events_id_seq')", 'NEXTVAL'],
    ['postgres', "SELECT set_config('x', 'y', false)", 'SET_CONFIG'],
    ['postgres', 'SELECT pg_terminate_backend(42)', 'PG_TERMINATE_BACKEND'],
    ['postgres', "SELECT pg_read_file('/etc/passwd')", 'PG_READ_FILE'],
    ['mysql', "SELECT LOAD_FILE('/etc/passwd')", 'LOAD_FILE'],
    ['mysql', "SELECT GET_LOCK('x', 10)", 'GET_LOCK'],
  ];
  for (const [engine, text, word] of cases) {
    assert.deepEqual(checkReadOnly(text, engine), { error: E.FORBIDDEN, word }, text);
  }
});

test('what the scanner cannot be sure of is refused', () => {
  assert.equal(checkReadOnly("SELECT 'open", 'postgres').error, E.UNTERMINATED);
  assert.equal(checkReadOnly('SELECT 1 /* open', 'mysql').error, E.UNTERMINATED);
  assert.equal(checkReadOnly('SELECT $$open', 'postgres').error, E.UNTERMINATED);
  // MySQL and MariaDB run the content of an executable comment.
  assert.equal(checkReadOnly('SELECT 1 /*! ; DROP TABLE t */', 'mysql').error, E.UNTERMINATED);
  assert.equal(checkReadOnly('SELECT 1 /*M!100000 x */', 'mysql').error, E.UNTERMINATED);
});

test('backslash escapes follow the engine', () => {
  // MySQL: \' does not close the string; the ";" stays inside.
  assert.ok(checkReadOnly("SELECT 'a\\'; DROP TABLE t; '", 'mysql').sql);
  // PostgreSQL (standard strings): \ is a plain character, the string closes
  // after it and the ";" is code.
  assert.equal(checkReadOnly("SELECT 'a\\' ; SELECT ';'", 'postgres').error, E.MULTIPLE);
  // PostgreSQL E'…' strings do escape.
  assert.ok(checkReadOnly("SELECT E'a\\'; DROP TABLE t; '", 'postgres').sql);
  // Nested block comments are a PostgreSQL feature.
  assert.ok(checkReadOnly('SELECT 1 /* a /* b */ ; */', 'postgres').sql);
  assert.equal(checkReadOnly('SELECT 1 /* a /* b */ ; */', 'mysql').error, E.MULTIPLE);
});
