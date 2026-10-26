// -----------------------------------------------------------------------------
// The SQL client on the real answers of PostgreSQL 17, MariaDB 11 and MySQL 8
// (test/fixtures/real): the read-only transaction around every query, the
// time limits, the error kinds, the server versions, and the value read for
// each type.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractValue } from '../src/queries.js';
import { ERROR_KINDS as K, SqlClient, classify, serverVersion } from '../src/sql/client.js';
import { ENGINE_OF, FIXTURES, FakeSql } from './helpers/fakeSql.js';

const clientFor = (db, extra = {}) =>
  new SqlClient({
    engine: ENGINE_OF[db.server],
    host: '192.0.2.20',
    port: 5432,
    database: 'home',
    user: 'reader',
    password: 'readerpw',
    tls: 'off',
    timeoutMs: 10_000,
    drivers: db.drivers(),
    ...extra,
  });

test('server versions, as shown', () => {
  assert.equal(serverVersion('postgres', FIXTURES.postgres.version), 'PostgreSQL 17.11');
  assert.equal(serverVersion('mysql', FIXTURES.mariadb.version), 'MariaDB 11.8.9');
  assert.equal(serverVersion('mysql', FIXTURES.mysql.version), 'MySQL 8.4.13');
});

test('PostgreSQL: read-only session and transaction, time limit, extended protocol', async () => {
  const db = new FakeSql('postgres');
  const client = clientFor(db);
  const result = await client.query(`${db.sql('last')};`);
  assert.deepEqual(result, { rows: [{ temperature: '21.30' }], columns: ['temperature'] });
  assert.deepEqual(db.statements, [
    'BEGIN READ ONLY',
    'SET LOCAL statement_timeout = 10000',
    db.sql('last'),
    'ROLLBACK',
  ]);
  const [options] = db.connections;
  assert.equal(options.options, '-c default_transaction_read_only=on');
  assert.equal(options.statement_timeout, 10_000);
  assert.equal(options.ssl, false);
  // A second statement is refused by the server in the extended protocol.
  assert.equal(db.modes.get(db.sql('last')), 'extended');
  assert.equal(db.open, 0, 'the connection is closed');
});

test('MariaDB and MySQL: read-only session and transaction, the time limit of each', async () => {
  for (const [server, limit] of [
    ['mariadb', 'SET SESSION max_statement_time = 10'],
    ['mysql', 'SET SESSION max_execution_time = 10000'],
  ]) {
    const db = new FakeSql(server);
    const client = clientFor(db, { tls: 'require' });
    await client.query(db.sql('count'));
    assert.deepEqual(db.statements, [
      'SELECT version() AS v',
      'SET SESSION TRANSACTION READ ONLY',
      limit,
      'START TRANSACTION READ ONLY',
      db.sql('count'),
      'ROLLBACK',
    ]);
    assert.equal(db.connections[0].multipleStatements, false);
    assert.deepEqual(db.connections[0].ssl, { rejectUnauthorized: false });
    assert.equal(db.open, 0);
  }
});

test('the guard refuses before any connection', async () => {
  const db = new FakeSql('postgres');
  await assert.rejects(clientFor(db).query('DELETE FROM events'), {
    kind: K.REFUSED,
    reason: 'not_select',
  });
  assert.equal(db.connections.length, 0);
});

test('real errors are sorted into kinds', () => {
  const expected = {
    postgres: { syntax: K.QUERY, notable: K.QUERY, writeInRo: K.READ_ONLY, timeout: K.TIMEOUT },
    mariadb: { syntax: K.QUERY, notable: K.QUERY, writeInRo: K.QUERY, timeout: K.TIMEOUT },
    mysql: { syntax: K.QUERY, notable: K.QUERY, writeInRo: K.QUERY, timeout: K.TIMEOUT },
  };
  for (const [server, fixture] of Object.entries(FIXTURES)) {
    for (const [key, kind] of Object.entries(expected[server])) {
      const error = Object.assign(new Error(), fixture.queries[key].error);
      assert.equal(classify(error).kind, kind, `${server} ${key}`);
    }
    // A user who may write is stopped by the read-only transaction.
    const ro = Object.assign(new Error(), fixture.queries.writeInRoWriter.error);
    assert.equal(classify(ro).kind, K.READ_ONLY, `${server} read-only transaction`);
    const connect = (name) =>
      classify(Object.assign(new Error(), fixture.connectErrors[name])).kind;
    assert.equal(connect('auth'), K.AUTH, `${server} auth`);
    assert.equal(connect('database'), K.DATABASE, `${server} database`);
    assert.equal(connect('refused'), K.UNREACHABLE, `${server} refused`);
  }
  assert.equal(classify(new Error('timeout expired')).kind, K.UNREACHABLE);
  assert.equal(classify(new Error('The server does not support SSL connections')).kind, K.TLS);
  assert.equal(classify(Object.assign(new Error('x'), { code: 'ETIMEDOUT' })).kind, K.UNREACHABLE);
  assert.equal(
    classify(
      Object.assign(new Error('self-signed certificate'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }),
    ).kind,
    K.TLS,
  );
});

test('a connection error is thrown with its kind, the session closed', async () => {
  for (const server of ['postgres', 'mariadb', 'mysql']) {
    const db = new FakeSql(server);
    db.failure = 'auth';
    await assert.rejects(clientFor(db).version(), { kind: K.AUTH });
    db.failure = 'refused';
    await assert.rejects(clientFor(db).query(db.sql('last')), { kind: K.UNREACHABLE });
    assert.equal(db.open, 0);
  }
});

test('the value of the first row, for every type, on the real rows of each server', () => {
  for (const [server, fixture] of Object.entries(FIXTURES)) {
    const read = (key, column, type) => extractValue(fixture.queries[key], column, type);
    assert.deepEqual(read('last', '', 'temperature'), { value: 21.3 }, server);
    assert.deepEqual(read('avg', 'avg_temp', 'number'), { value: 20.9 }, server);
    assert.deepEqual(read('avg', 'N', 'number'), { value: 2 }, `${server}: column case`);
    assert.deepEqual(read('humidity', '', 'humidity'), { value: 47 }, server);
    assert.deepEqual(read('count', 'rows', 'number'), { value: 3 }, server);
    assert.deepEqual(read('room', 'room', 'text'), { value: 'living' }, server);
    assert.deepEqual(read('room', 'room', 'number'), { value: null, error: 'not_number' }, server);
    assert.deepEqual(read('backup', '', 'boolean'), { value: 1 }, server);
    assert.deepEqual(
      read('room', 'room', 'boolean'),
      { value: null, error: 'not_boolean' },
      server,
    );
    assert.ok(read('size', 'mb', 'size').value > 0, server);
    assert.match(String(read('date', '', 'text').value), /^2026-10-20/, server);
    assert.deepEqual(read('none', '', 'number'), { value: null }, `${server}: no row`);
    assert.deepEqual(read('nullmax', '', 'number'), { value: null }, `${server}: NULL`);
    assert.deepEqual(read('last', 'nothing', 'number'), { value: null, error: 'column' }, server);
  }
});

test('booleans and texts in their usual spellings', () => {
  const one = (cell, type) => extractValue({ rows: [{ a: cell }], columns: ['a'] }, '', type);
  for (const yes of [true, 1, '1', 't', 'TRUE', 'yes', 'on', 2]) {
    assert.equal(one(yes, 'boolean').value, 1, String(yes));
  }
  for (const no of [false, 0, '0', 'f', 'false', 'No', 'off']) {
    assert.equal(one(no, 'boolean').value, 0, String(no));
  }
  assert.equal(one('  a\n b ', 'text').value, 'a b');
  assert.equal(one('x'.repeat(300), 'text').value.length, 250);
  assert.equal(one({ a: 1 }, 'text').value, '{"a":1}');
  assert.equal(one('', 'text').value, null);
  assert.equal(one(12345678901234567890n, 'number').value, 12345678901234567000);
  assert.equal(one('1e3', 'number').value, 1000);
  assert.equal(one('12,5', 'number').error, 'not_number');
});
