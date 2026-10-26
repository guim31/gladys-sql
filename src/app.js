// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake Gladys)
// and returns the hub, so index.js stays a few lines and the tests drive the
// very same wiring. (Adapted from guim31/gladys-influxdb.)
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { AnswerError, SqlHub } from './hub.js';
import { SCENE_ACTIONS } from './scenes.js';
import { Store } from './store.js';
import { INIT_FAILED } from './texts.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'sql-app' });

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: store, drivers, timers, timings, now
 */
export function registerHandlers(gladys, options = {}) {
  const hub = new SqlHub({
    gladys,
    store: options.store ?? new Store(),
    drivers: options.drivers,
    timers: options.timers ?? true,
    timings: options.timings,
    now: options.now,
  });

  // Resolved once the hub has started; every handler waits for it, so a
  // request arriving during the first read is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = normalizeConfig(await gladys.getConfig());
      if (started) {
        // A reconnection (Gladys restarted): send again what Gladys may have lost.
        await hub.resync(config);
        return;
      }
      started = true;
      await hub.start(config);
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, INIT_FAILED).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.onScanRequest(whenReady(() => hub.rediscover()));

  // The device is published with should_poll: false (the hub reads the
  // database on its own timer); this only serves a Gladys that would poll
  // anyway.
  gladys.onPoll(whenReady(() => hub.pollDevice()));

  gladys.onDeviceCreated(whenReady((device) => hub.onDeviceCreated(device)));
  // "Update" in the Discovery tab adds the features of new queries, whose
  // states Gladys dropped: send everything again too.
  gladys.onDeviceUpdated(whenReady((device) => hub.onDeviceCreated(device)));

  gladys.onConfigUpdated(
    whenReady(async (newConfig) => {
      await hub.reconfigure(normalizeConfig(newConfig));
    }),
  );

  // A configuration action displays what it resolves, in every language,
  // while a thrown error shows a single string: the mistakes of the user (a
  // query refused, an unknown name) are answered, not thrown.
  const answered =
    (fn) =>
    async (...args) => {
      // The start failed (no configuration): say so instead of a TypeError.
      if (!hub.config) {
        return INIT_FAILED;
      }
      try {
        return await fn(...args);
      } catch (err) {
        if (err instanceof AnswerError) {
          return err.messages;
        }
        throw err;
      }
    };
  const actions = {
    test_connection: () => hub.testConnection(),
    add_query: (fields) => hub.addQuery(fields ?? {}),
    remove_query: (fields) => hub.removeQuery(fields ?? {}),
  };
  for (const [key, handler] of Object.entries(actions)) {
    gladys.onAction(key, whenReady(answered(handler)));
  }

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady((fields) => handler(hub, { fields })),
    );
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(hub, request)),
    );
    gladys.onWidgetAction(
      key,
      whenReady((actionKey, params, context = {}) =>
        widget.action(hub, { actionKey, params, ...context }),
      ),
    );
  }

  return {
    hub,
    ready,
    stop: () => hub.stop(),
  };
}
