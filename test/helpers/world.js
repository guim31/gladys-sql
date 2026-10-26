// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake database replaying
// real answers, a temporary /data and a manual clock, with the integration
// wired on top through registerHandlers. No timer runs: the tests read with
// `world.hub.readDue()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { databaseIds } from '../../src/devices.js';
import { Store } from '../../src/store.js';
import { ENGINE_OF, FIXTURES, FakeSql } from './fakeSql.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

/** The configuration a user would type for a recorded server. */
export const configFor = (server = 'postgres', extra = {}) => ({
  engine: ENGINE_OF[server],
  host: '192.0.2.20',
  database: 'home',
  username: 'reader',
  password: 'readerpw',
  language: 'en',
  ...extra,
});

/** A manual clock, shared by the hub and the tests. */
export function createClock(start = Date.parse('2026-10-20T10:00:00Z')) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export async function createWorld({
  server = 'postgres',
  clock = createClock(),
  config = configFor(server),
  db = new FakeSql(server),
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-sql-')),
  timings = {},
  timers = false,
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    drivers: db.drivers(),
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, db, app, hub: app.hub, clock, dataDir };
}

export const deviceId = (gladys) => databaseIds(gladys).device;

/** Add the discovered device in Gladys, as the user would. */
export async function createDevices(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

/** Run a configuration action; its message in English (or throws its error). */
export async function action(world, key, fields) {
  const ack = await world.fake.action(key, fields);
  if (!ack.success) {
    throw new Error(ack.error);
  }
  return ack.data?.message?.en ?? ack.data?.message ?? ack.data;
}

export const addQuery = (world, fields) => action(world, 'add_query', fields);

export { FIXTURES, FakeSql };
