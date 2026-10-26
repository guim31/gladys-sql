// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from the real
// answers of PostgreSQL, MariaDB and MySQL (test/fixtures/real): a query of
// every type on each server, in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { QUERY_TYPE_KEYS } from '../src/queries.js';
import { addQuery, configFor, createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

// A real query answering each type.
const QUERY_OF = {
  number: ['count', 'rows'],
  temperature: ['last', ''],
  humidity: ['humidity', ''],
  percent: ['humidity', ''],
  power: ['avg', 'avg_temp'],
  energy: ['avg', 'n'],
  size: ['size', 'mb'],
  text: ['room', 'room'],
  boolean: ['backup', ''],
};

async function discover(language) {
  const devices = [];
  for (const server of ['postgres', 'mariadb', 'mysql']) {
    const world = await createWorld({ server, config: configFor(server, { language }) });
    for (const type of QUERY_TYPE_KEYS) {
      const [key, column] = QUERY_OF[type];
      await addQuery(world, { name: `${type} query`, query: world.db.sql(key), column, type });
    }
    // Names that collide with the fixed features, in every language.
    for (const name of ['Version', 'Reachable', 'Joignable', 'Erreichbar', 'Accesible']) {
      await addQuery(world, { name, query: world.db.sql('count') });
    }
    await world.app.stop();
    devices.push(...world.fake.discoveredDevices);
  }
  return devices;
}

for (const language of ['en', 'fr', 'de', 'es']) {
  test(`every discovered device follows the Gladys rules (${language} names)`, async () => {
    const devices = await discover(language);
    assert.equal(devices.length, 3, 'one device per database');
    for (const device of devices) {
      const where = device.name;
      assert.equal(device.features.length, 2 + QUERY_TYPE_KEYS.length + 5, `${where}: features`);

      // should_poll: true if and only if poll_frequency is provided, in ms.
      if (device.poll_frequency === undefined) {
        assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
      } else {
        assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
        assert.ok(
          table.poll_frequencies_ms.includes(device.poll_frequency),
          `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
        );
      }

      const externalIds = new Set();
      const names = new Set();
      for (const feature of device.features) {
        const at = `${where} / ${feature.name}`;
        const pair = table.pairs[`${feature.category}/${feature.type}`];
        assert.ok(pair, `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`);
        assert.ok(
          pair.label_en && pair.label_fr && pair.icon,
          `${at}: couple without label or icon`,
        );

        assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
        assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
        assert.ok(
          Number.isFinite(feature.min) && Number.isFinite(feature.max),
          `${at}: finite min/max`,
        );
        assert.ok(feature.min <= feature.max, `${at}: min > max`);
        assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
        assert.equal(
          typeof feature.has_feedback,
          'boolean',
          `${at}: has_feedback must be a boolean`,
        );
        if (feature.unit !== undefined) {
          assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
        }

        assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
        externalIds.add(feature.external_id);
        assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
        names.add(feature.name);
      }
    }
  });
}
