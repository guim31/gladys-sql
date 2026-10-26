// -----------------------------------------------------------------------------
// The integration end to end, against the SDK's fake Gladys and the recorded
// answers of real databases: the device and its features, the states, the
// intervals, the scene events, the configuration actions, persistence and
// quiet logs.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseHost } from '../src/config.js';
import { FEATURES, databaseIds, queryFeatureKey } from '../src/devices.js';
import { DOWN_AFTER_READS, TRIGGERS } from '../src/hub.js';
import { queryId } from '../src/queries.js';
import {
  action,
  addQuery,
  configFor,
  createClock,
  createDevices,
  createWorld,
  deviceId,
} from './helpers/world.js';

const featureId = (world, name, type = 'number') =>
  databaseIds(world.gladys).feature(queryFeatureKey({ id: queryId(name), type }));
const online = (world) => databaseIds(world.gladys).feature(FEATURES.ONLINE);
const version = (world) => databaseIds(world.gladys).feature(FEATURES.VERSION);

test('the configuration: host, port, defaults', () => {
  assert.deepEqual(parseHost(' 192.0.2.5:5433 '), { host: '192.0.2.5', port: 5433 });
  assert.deepEqual(parseHost('postgres://db.home.lan/home'), { host: 'db.home.lan', port: null });
  assert.deepEqual(parseHost('[2001:db8::1]:3306'), { host: '2001:db8::1', port: 3306 });
  assert.equal(parseHost('user:pw@192.0.2.5'), null);
  assert.equal(parseHost('not a host'), null);
  const config = normalizeConfig({ engine: 'mysql', host: '192.0.2.5', database: ' home ' });
  assert.equal(config.port, 3306);
  assert.equal(config.database, 'home');
  assert.equal(config.pollIntervalMs, 60_000);
  assert.equal(config.timeoutMs, 10_000);
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({ host: '192.0.2.5:6000', port: '5433' }).port, 5433);
  assert.equal(normalizeConfig({ host: '192.0.2.5:6000' }).port, 6000);
  assert.equal(normalizeConfig({ host: 'a b' }).invalidHost, true);
});

test('missing fields: no client, a status that says what to fill', async (t) => {
  const world = await createWorld({ config: { language: 'en' } });
  t.after(() => world.app.stop());
  assert.equal(world.hub.client, null);
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /address of your database/);
  assert.match(world.fake.connectionStatus.message.de, /Gib die Adresse/);
  assert.deepEqual(world.db.connections, []);
});

test('the database device: reachable, version, one feature per query', async (t) => {
  for (const server of ['postgres', 'mariadb', 'mysql']) {
    const world = await createWorld({ server });
    t.after(() => world.app.stop());
    assert.equal(world.fake.connectionStatus.connected, true);
    const [device] = world.fake.discoveredDevices;
    assert.equal(device.external_id, deviceId(world.gladys));
    assert.equal(device.should_poll, false);
    assert.deepEqual(
      device.features.map((feature) => feature.name),
      ['Reachable', 'Version'],
    );
    assert.equal(
      device.name,
      { postgres: 'PostgreSQL home', mariadb: 'MariaDB home', mysql: 'MySQL home' }[server],
    );

    const message = await addQuery(world, {
      name: 'Living room',
      query: world.db.sql('last'),
      type: 'temperature',
    });
    assert.equal(
      message,
      'Query "Living room" added, value: 21.3, add the database from the Discover tab.',
    );
    const [updated] = world.fake.discoveredDevices;
    const feature = updated.features.at(-1);
    assert.equal(feature.name, 'Living room');
    assert.equal(feature.external_id, featureId(world, 'Living room', 'temperature'));
    assert.deepEqual(
      [feature.category, feature.type, feature.unit],
      ['temperature-sensor', 'decimal', 'celsius'],
    );
  }
});

test('states: nothing before the device exists, everything at its creation, then changes only', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await addQuery(world, { name: 'Rows', query: world.db.sql('count'), column: 'rows' });
  await addQuery(world, {
    name: 'Room',
    query: world.db.sql('room'),
    column: 'room',
    type: 'text',
  });
  await addQuery(world, { name: 'Backup', query: world.db.sql('backup'), type: 'boolean' });
  assert.deepEqual(world.fake.states, []);

  await createDevices(world);
  assert.equal(world.fake.lastState(online(world)), 1);
  assert.equal(world.fake.lastState(version(world)), 'PostgreSQL 17.11');
  assert.equal(world.fake.lastState(featureId(world, 'Rows')), 3);
  assert.equal(world.fake.lastState(featureId(world, 'Room', 'text')), 'living');
  assert.equal(world.fake.lastState(featureId(world, 'Backup', 'boolean')), 1);
  assert.ok(world.fake.widgetRefreshes.length > 0, 'the widget is refreshed');

  // Same values a minute later: nothing sent.
  const sent = world.fake.states.length;
  world.clock.advance(60_000);
  await world.hub.readDue();
  assert.equal(world.fake.states.length, sent);
  // A new value: only it.
  world.db.answers.set(world.db.sql('count'), { rows: [{ rows: '4' }], columns: ['rows'] });
  world.clock.advance(60_000);
  await world.hub.readDue();
  assert.deepEqual(
    world.fake.states.slice(sent).map((state) => state.state),
    [4],
  );
  // Heartbeat: an unchanged value is sent again after 6 h.
  world.clock.advance(6 * 3600_000);
  await world.hub.readDue();
  assert.ok(world.fake.states.length > sent + 1);
});

test('each query at its interval, the database at the configured one', async (t) => {
  const world = await createWorld({ config: configFor('postgres', { poll_interval: '300' }) });
  t.after(() => world.app.stop());
  await addQuery(world, { name: 'Fast', query: world.db.sql('count'), interval: '30' });
  await addQuery(world, { name: 'Slow', query: world.db.sql('last'), interval: '3600' });
  await addQuery(world, { name: 'Default', query: world.db.sql('humidity') });
  const runs = (key) => world.db.statements.filter((sql) => sql === world.db.sql(key)).length;
  const before = { count: runs('count'), last: runs('last'), humidity: runs('humidity') };
  for (let step = 0; step < 20; step += 1) {
    world.clock.advance(15_000); // the tick of the timer
    await world.hub.readDue();
  }
  // 300 s later: Fast ran 10 times, Default once, Slow never.
  assert.equal(runs('count') - before.count, 10);
  assert.equal(runs('humidity') - before.humidity, 1);
  assert.equal(runs('last') - before.last, 0);
});

test('the database down: unreachable after two reads, back once, the badge follows', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  world.db.failure = 'refused';
  for (let read = 0; read < DOWN_AFTER_READS; read += 1) {
    world.clock.advance(60_000);
    await world.hub.readDue();
  }
  assert.deepEqual(
    world.fake.sceneEvents.map((event) => event.key),
    [TRIGGERS.DATABASE_DOWN],
  );
  assert.deepEqual(world.fake.sceneEvents[0].data, {
    error: 'does not answer: check the address and the port',
    error_kind: 'unreachable',
  });
  assert.equal(world.fake.lastState(online(world)), 0);
  assert.equal(world.fake.transports.at(-1).transport, 'unreachable');
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.fr, /^home : ne répond pas/);
  // Still down: nothing more.
  world.clock.advance(60_000);
  await world.hub.readDue();
  assert.equal(world.fake.sceneEvents.length, 1);

  world.db.failure = null;
  world.clock.advance(60_000);
  await world.hub.readDue();
  assert.deepEqual(world.fake.sceneEvents.at(-1), {
    key: TRIGGERS.DATABASE_UP,
    data: { duration_minutes: 3 },
  });
  assert.equal(world.fake.lastState(online(world)), 1);
  assert.equal(world.fake.transports.at(-1).transport, 'local');
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('wrong password and unknown database are reported as such', async (t) => {
  for (const [failure, text] of [
    ['auth', /check the user and the password/],
    ['database', /database not found/],
  ]) {
    const world = await createWorld({ server: 'mariadb' });
    t.after(() => world.app.stop());
    world.db.failure = failure;
    const message = await action(world, 'test_connection');
    assert.match(message, text);
  }
});

test('a query that fails, then works again: one event each', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await addQuery(world, { name: 'Rows', query: world.db.sql('count') });
  world.db.answers.set(world.db.sql('count'), {
    error: world.db.fixture.queries.timeout.error,
  });
  world.clock.advance(60_000);
  await world.hub.readDue();
  world.clock.advance(60_000);
  await world.hub.readDue();
  assert.deepEqual(world.fake.sceneEvents, [
    {
      key: TRIGGERS.QUERY_FAILED,
      data: { name: 'Rows', error: 'too slow: time limit reached' },
    },
  ]);
  world.db.answers.set(world.db.sql('count'), world.db.fixture.queries.count);
  world.clock.advance(60_000);
  await world.hub.readDue();
  assert.deepEqual(world.fake.sceneEvents.at(-1), {
    key: TRIGGERS.QUERY_BACK,
    data: { name: 'Rows', value: '3' },
  });
});

test('a value that does not fit its type fails; no row is not a failure', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const message = await addQuery(world, {
    name: 'Room',
    query: world.db.sql('room'),
    column: 'room',
  });
  assert.match(message, /value is not a number: choose the Text type/);
  assert.equal(world.fake.sceneEvents.at(-1).key, TRIGGERS.QUERY_FAILED);
  const empty = await addQuery(world, { name: 'Attic', query: world.db.sql('nullmax') });
  assert.match(empty, /no row \(or NULL\) for now/);
  assert.equal(world.fake.sceneEvents.length, 1);
});

test('"Add a query" refuses what writes, what the database refuses, and keeps nothing', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const refused = (fields) => world.fake.action('add_query', fields);
  let ack = await refused({ name: 'Bad', query: 'DELETE FROM events' });
  assert.equal(ack.data.message.en, 'Query refused: only SELECT (or WITH … SELECT) is accepted');
  ack = await refused({ name: 'Bad', query: 'SELECT 1; DROP TABLE events' });
  assert.match(ack.data.message.fr, /une seule requête/);
  ack = await refused({
    name: 'Bad',
    query: 'WITH d AS (DELETE FROM events RETURNING *) SELECT 1',
  });
  assert.match(ack.data.message.en, /this word writes or locks, it is refused: DELETE/);
  ack = await refused({ name: 'Bad', query: world.db.sql('syntax') });
  assert.match(ack.data.message.en, /error in the query \(syntax error at or near "WHERE"\)/);
  // A SELECT calling a function that writes: the read-only transaction refuses it.
  world.db.answers.set('SELECT archive_old_rows()', {
    error: world.db.fixture.queries.writeInRoWriter.error,
  });
  ack = await refused({ name: 'Bad', query: 'SELECT archive_old_rows()' });
  assert.match(ack.data.message.en, /refused by the database: it would write/);
  ack = await refused({ name: '', query: 'SELECT 1' });
  assert.match(ack.data.message.en, /Give the query a name/);
  ack = await refused({ name: 'x', query: 'SELECT 1', type: 'nope' });
  assert.match(ack.data.message.en, /Choose a type/);
  assert.equal(world.hub.queries.size, 0);
  // Nothing reached the database for the texts the guard refused.
  assert.ok(!world.db.statements.some((sql) => /DELETE|DROP/.test(sql)));
});

test('"Remove a query" and a restart: the queries and announced events are kept', async (t) => {
  const clock = createClock();
  const world = await createWorld({ clock });
  await addQuery(world, { name: 'Rows', query: world.db.sql('count') });
  await addQuery(world, { name: 'Last', query: world.db.sql('last') });
  world.db.failure = 'refused';
  world.clock.advance(60_000);
  await world.hub.readDue();
  world.clock.advance(60_000);
  await world.hub.readDue();
  assert.equal(world.fake.sceneEvents.length, 1);
  assert.equal(
    await action(world, 'remove_query', { name: ' rows ' }),
    'Query "Rows" removed, 1 query(ies).',
  );
  const missing = await world.fake.action('remove_query', { name: 'Rows' });
  assert.equal(missing.data.message.en, 'No query named "Rows".');
  await world.app.stop();

  // Restarted while the database is still down: no second announce.
  const again = await createWorld({ clock, dataDir: world.dataDir, db: world.db });
  t.after(() => again.app.stop());
  assert.deepEqual(
    [...again.hub.queries.values()].map((query) => query.name),
    ['Last'],
  );
  again.clock.advance(60_000);
  await again.hub.readDue();
  assert.equal(again.fake.sceneEvents.length, 0);
  again.db.failure = null;
  again.clock.advance(60_000);
  await again.hub.readDue();
  assert.equal(again.fake.sceneEvents.at(-1).key, TRIGGERS.DATABASE_UP);
});

test('"Test the connection" sums up the database and the queries', async (t) => {
  const world = await createWorld({ server: 'mysql' });
  t.after(() => world.app.stop());
  assert.equal(
    await action(world, 'test_connection'),
    'OK, MySQL 8.4.13, no query yet: use "Add a query".',
  );
  await addQuery(world, { name: 'Rows', query: world.db.sql('count') });
  await addQuery(world, { name: 'Attic', query: world.db.sql('none') });
  const ack = await world.fake.action('test_connection');
  assert.equal(
    ack.data.message.en,
    'OK, MySQL 8.4.13, 2 query(ies), Attic: no row (or NULL) for now.',
  );
  assert.equal(
    ack.data.message.fr,
    'OK, MySQL 8.4.13, 2 requête(s), Attic : aucune ligne (ou NULL) pour le moment.',
  );
});

test('a query named like a fixed feature gets a distinct name', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await addQuery(world, { name: 'version', query: world.db.sql('count') });
  const names = world.fake.discoveredDevices[0].features.map((feature) => feature.name);
  assert.deepEqual(names, ['Reachable', 'Version', 'version (2)']);
});

test('a normal cycle writes nothing at the info level', async (t) => {
  const lines = [];
  const world = await createWorld();
  t.after(() => world.app.stop());
  await addQuery(world, { name: 'Rows', query: world.db.sql('count') });
  await createDevices(world);
  const original = process.stdout.write;
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';
  process.stdout.write = (chunk) => {
    lines.push(String(chunk));
    return true;
  };
  try {
    for (let step = 0; step < 5; step += 1) {
      world.clock.advance(60_000);
      await world.hub.readDue();
    }
    assert.deepEqual(lines, []);
    // The capture works: an action of the user writes its line.
    await action(world, 'remove_query', { name: 'Rows' });
  } finally {
    process.stdout.write = original;
    process.env.LOG_LEVEL = previous;
  }
  assert.equal(lines.length, 1);
  assert.match(lines[0], /Query removed: Rows/);
});

test('the password never reaches the logs, the messages or the device', async (t) => {
  const world = await createWorld({ config: configFor('postgres', { password: 's3cr3t-pw' }) });
  t.after(() => world.app.stop());
  world.db.failure = 'auth';
  await action(world, 'test_connection');
  const everything = JSON.stringify([
    world.fake.discoveredDevices,
    world.fake.connectionStatuses,
    world.fake.sceneEvents,
    world.hub.errorText('en'),
  ]);
  assert.ok(!everything.includes('s3cr3t-pw'));
});
