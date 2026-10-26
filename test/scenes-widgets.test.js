// -----------------------------------------------------------------------------
// The scene action "Read an SQL query now" and the dashboard widget, through
// the SDK's fake Gladys, on the recorded answers of real databases. The
// widget content is checked with the validator of the SDK (the budget of the
// core) and in every language.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { ACTIONS, MAX_ROWS } from '../src/widgets.js';
import { addQuery, configFor, createWorld } from './helpers/world.js';

test('read a saved query by its name, with its type and unit', async (t) => {
  const world = await createWorld({ config: configFor('mariadb', { language: 'fr' }) });
  t.after(() => world.app.stop());
  await addQuery(world, { name: 'Salon', query: world.db.sql('last'), type: 'temperature' });
  const ack = await world.fake.sceneAction('read_query', { query: ' salon ' });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, { value: 21.3, text: '21,3 °C' });
});

test('read a one-off SELECT: its first column, a number or a text', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  let ack = await world.fake.sceneAction('read_query', { query: world.db.sql('count') });
  assert.deepEqual(ack.data.outputs, { value: 3, text: '3' });
  ack = await world.fake.sceneAction('read_query', { query: world.db.sql('room') });
  assert.deepEqual(ack.data.outputs, { value: 0, text: 'living' });
  ack = await world.fake.sceneAction('read_query', { query: world.db.sql('none') });
  assert.deepEqual(ack.data.outputs, { value: 0, text: '' });
});

test('the scene action refuses what writes, and says why in the configured language', async (t) => {
  const world = await createWorld({ config: configFor('postgres', { language: 'de' }) });
  t.after(() => world.app.stop());
  let ack = await world.fake.sceneAction('read_query', { query: 'DROP TABLE events' });
  assert.equal(ack.success, false);
  assert.match(ack.error, /nur SELECT/);
  ack = await world.fake.sceneAction('read_query', { query: '' });
  assert.match(ack.error, /Gib den Namen einer Abfrage/);
  ack = await world.fake.sceneAction('read_query', { query: world.db.sql('syntax') });
  assert.match(ack.error, /Fehler in der Abfrage/);
  world.db.failure = 'refused';
  ack = await world.fake.sceneAction('read_query', { query: world.db.sql('count') });
  assert.match(ack.error, /antwortet nicht/);
  assert.ok(!world.db.statements.includes('DROP TABLE events'));
});

test('the widget: the database, then a row per query, in every language, within the budget', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await addQuery(world, { name: 'Living room', query: world.db.sql('last'), type: 'temperature' });
  await addQuery(world, {
    name: 'Room',
    query: world.db.sql('room'),
    column: 'room',
    type: 'text',
  });
  await addQuery(world, { name: 'Backup ok', query: world.db.sql('backup'), type: 'boolean' });
  await addQuery(world, { name: 'Attic', query: world.db.sql('none') });
  await addQuery(world, { name: 'Broken', query: world.db.sql('room'), column: 'room' });
  for (const language of ['en', 'fr', 'de', 'es']) {
    const ack = await world.fake.widgetGet(WIDGET_KEY, { language });
    assert.equal(ack.success, true, ack.error);
    const { content } = ack.data;
    assert.doesNotThrow(() => validateWidgetContent(content), language);
    const [status, button] = content.components;
    assert.equal(status.type, 'status');
    assert.equal(button.action.key, ACTIONS.REFRESH);
    if (language === 'en') {
      assert.deepEqual(
        status.items.map((item) => [item.label, item.value]),
        [
          ['Database home', 'PostgreSQL 17.11'],
          ['Attic', 'No data'],
          ['Backup ok', 'Yes'],
          ['Broken', 'Error'],
          ['Living room', '21.3 °C'],
          ['Room', 'living'],
        ],
      );
    }
  }
});

test('the widget without configuration, without query, with the database down, and with many queries', async (t) => {
  const bare = await createWorld({ config: { language: 'en' } });
  t.after(() => bare.app.stop());
  let content = (await bare.fake.widgetGet(WIDGET_KEY, { language: 'es' })).data.content;
  assert.match(content.components[0].text, /Introduzca la dirección/);

  const world = await createWorld();
  t.after(() => world.app.stop());
  content = (await world.fake.widgetGet(WIDGET_KEY, { language: 'en' })).data.content;
  assert.doesNotThrow(() => validateWidgetContent(content));
  assert.match(content.components[1].text, /No query yet/);

  for (let index = 0; index < 12; index += 1) {
    await addQuery(world, {
      name: `Query ${String(index).padStart(2, '0')}`,
      query: world.db.sql('count'),
    });
  }
  world.db.failure = 'refused';
  world.clock.advance(60_000);
  await world.hub.readDue();
  content = (await world.fake.widgetGet(WIDGET_KEY, { language: 'fr' })).data.content;
  assert.doesNotThrow(() => validateWidgetContent(content));
  assert.match(content.components[0].text, /^home : ne répond pas/);
  const status = content.components[1];
  assert.equal(status.items.length, MAX_ROWS);
  assert.deepEqual(status.items[0].value, 'Injoignable');
  assert.deepEqual(status.items.at(-1), {
    label: 'Autres',
    value: '+4',
    icon: 'more-horizontal',
    color: 'neutral',
  });

  // "Refresh" reads again, now.
  world.db.failure = null;
  const ack = await world.fake.widgetAction(WIDGET_KEY, ACTIONS.REFRESH, {});
  assert.equal(ack.success, true, ack.error);
  assert.equal(world.hub.error, null);
});
