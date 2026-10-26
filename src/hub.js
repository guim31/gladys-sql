// -----------------------------------------------------------------------------
// The SQL hub: reads the database on a timer of the container; publishes the
// states of the device when they change; fires the scene events (database
// unreachable and back, a query that fails and works again); holds the
// queries, and the views the widget and the scene actions read.
//
// Gladys never polls the device (should_poll: false): the intervals go up to
// one hour, beyond the fixed list of the core scheduler.
//
// One cycle = a connection that reads the server version (it checks the
// address, the TLS, the user and the database), then one connection per query
// due, three at a time. A tick every TICK_MS looks for what is due: the
// database at the interval of the configuration, each query at its own.
// The events already announced are kept in /data (src/store.js): a restart
// neither announces a failure twice nor forgets to say the database is back.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { missingField, placeOf } from './config.js';
import { FEATURES, buildDatabaseDevice, databaseIds, queryFeatureKey } from './devices.js';
import { FailureLog } from './logs.js';
import {
  MAX_QUERIES,
  extractValue,
  intervalOf,
  parseQueryFields,
  queryId,
  restoreQuery,
} from './queries.js';
import { ERROR_KINDS, SERVER_ERRORS, SqlClient, SqlError, refusal } from './sql/client.js';
import { checkReadOnly } from './sql/guard.js';
import {
  CONNECTION_TEXT,
  QUERY_FIELD_TEXT,
  REPORT_TEXT,
  RESULT_TEXT,
  labelled,
  pick,
  problemText,
  sentence,
} from './texts.js';

const logger = createLogger({ name: 'sql-hub' });

export const WIDGET_KEY = 'values';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  DATABASE_DOWN: 'database_unreachable',
  DATABASE_UP: 'database_back',
  QUERY_FAILED: 'query_failed',
  QUERY_BACK: 'query_back',
});

export const HUB_TIMINGS = {
  // The timer looks for due reads this often.
  tickMs: 15_000,
  // An unchanged value is sent again this often: Gladys marks a value older
  // than 48 h as outdated.
  heartbeatMs: 6 * 3600_000,
};

// Failed cycles in a row before "The database is unreachable" is announced:
// a restart of the database (an update) does not start the scenes.
export const DOWN_AFTER_READS = 2;
const QUERY_CONCURRENCY = 3;
// A read is due slightly early: the timer does not drift by one tick.
const EARLY_MS = 1000;

/** The database itself: another one does not end the outage of this one. */
const placeKey = (config) =>
  JSON.stringify([config.engine, config.host, config.port, config.database]);

const signature = (config) =>
  JSON.stringify([
    config.engine,
    config.host,
    config.port,
    config.database,
    config.username,
    config.password,
    config.tls,
    config.timeoutMs,
  ]);

/** A user mistake answered to a configuration action, in every language. */
export class AnswerError extends Error {
  constructor(messages) {
    super(messages.en);
    this.messages = messages;
  }
}

export const inEveryLanguage = (render) =>
  Object.fromEntries(Object.keys(REPORT_TEXT).map((language) => [language, render(language)]));

/** A query result error as stored: a SqlError (kind, detail, reason) or a value error. */
const asProblem = (err) => ({ kind: err.kind, detail: err.detail ?? '', reason: err.reason });

export class SqlHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {object} [options.drivers] driver seam (src/sql/client.js DRIVERS)
   * @param {boolean} [options.timers] periodic timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, drivers, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.drivers = drivers;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.client = null;
    this.signature = null;
    /** @type {Map<string, object>} the queries, by id */
    this.queries = new Map();
    /** @type {Map<string, { value: number|string|null, error: object|null, at: number }>} */
    this.results = new Map();
    this.version = null;
    this.error = null; // the server: SqlError
    this.failedReads = 0;
    this.checkedAt = 0;
    this.downSince = null;
    this.polling = null;
    this.generation = 0;
    /** Last value published per feature external id, and when. */
    this.published = new Map();
    this.publishedAt = new Map();
    this.transport = null;
    this.connection = null;
    this.discovered = null;
    // What was announced to the scenes, kept across restarts.
    this.events = { down: null, failing: {} };
    this.tickTimer = null;
    this.stopped = false;
    this.failureLog = new FailureLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    for (const entry of Array.isArray(saved.queries) ? saved.queries : []) {
      const query = restoreQuery(entry);
      if (query && this.queries.size < MAX_QUERIES) {
        this.queries.set(query.id, query);
      }
    }
    const events = saved.events ?? {};
    this.events = {
      // An outage of another database (changed while the container was
      // stopped) is not ended by this one.
      down:
        Number.isFinite(events.down?.since) && events.down.place === placeKey(config)
          ? { since: events.down.since, place: events.down.place }
          : null,
      failing: events.failing && typeof events.failing === 'object' ? events.failing : {},
    };
    if (this.queries.size > 0) {
      logger.info(`${this.queries.size} query(ies) loaded`);
    }
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.published.clear();
    this.publishedAt.clear();
    this.transport = null;
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const changed = this.signature !== signature(config);
    // A new password or TLS option is the same database: its outage ends
    // with "The database answers again".
    const otherServer = this.signature !== null && placeKey(this.config) !== placeKey(config);
    const previousLanguage = this.config?.language;
    this.config = config;
    if (changed) {
      this.generation += 1; // a read in progress for the old database is ignored
      this.signature = signature(config);
      this.client = missingField(config)
        ? null
        : new SqlClient({
            engine: config.engine,
            host: config.host,
            port: config.port,
            database: config.database,
            user: config.username,
            password: config.password,
            tls: config.tls,
            timeoutMs: config.timeoutMs,
            drivers: this.drivers,
          });
      this.version = null;
      this.results.clear();
      this.error = null;
      this.failedReads = 0;
      this.downSince = null;
      this.checkedAt = 0;
      this.transport = null;
      if (otherServer && this.events.down) {
        // Another database (or none): the outage of the old one is not ended by it.
        this.events.down = null;
        this.save();
      }
    }
    if (previousLanguage && previousLanguage !== config.language) {
      this.discovered = null;
    }
    await this.readDue({ all: true, publish: true });
    this.scheduleTick();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.tickTimer);
    await this.polling?.catch(() => {});
    await this.store.flush();
  }

  save() {
    return this.store.save({ queries: [...this.queries.values()], events: this.events });
  }

  scheduleTick() {
    clearTimeout(this.tickTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.tickTimer = setTimeout(async () => {
      try {
        await this.readDue();
        this.failureLog.recover('poll', 'Reading the database works again');
      } catch (err) {
        this.failureLog.fail('poll', `Poll failed: ${err.message}`, 'error');
      }
      this.scheduleTick();
    }, this.timings.tickMs);
  }

  // --- Reading -------------------------------------------------------------------

  /** The queries due now (all of them with `all`). */
  dueQueries(all) {
    const now = this.now();
    return [...this.queries.values()].filter((query) => {
      if (all) {
        return true;
      }
      const at = this.results.get(query.id)?.at ?? 0;
      return now - at >= intervalOf(query, this.config) - EARLY_MS;
    });
  }

  /**
   * Read what is due, then publish what changed.
   * @param {object} [options]
   * @param {boolean} [options.all] every query, now
   * @param {boolean} [options.publish] publish the Discovery list again
   */
  async readDue({ all = false, publish = false } = {}) {
    const changed = await this.poll({ all });
    await this.afterChanges(changed, { publish });
  }

  /** Gladys asks for a refresh (onPoll): read everything now. */
  async pollDevice() {
    await this.readDue({ all: true });
  }

  /**
   * Read and apply what changed. Concurrent calls share the read; a call
   * for everything waits for a partial read and reads again.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll({ all = false } = {}) {
    if (!this.client) {
      return Promise.resolve(false);
    }
    if (this.polling && (all || this.pollingGeneration !== this.generation)) {
      return this.polling.catch(() => {}).then(() => this.poll({ all }));
    }
    if (!this.polling) {
      const serverDue = this.now() - this.checkedAt >= this.config.pollIntervalMs - EARLY_MS;
      const due = this.dueQueries(all);
      // A database that does not answer is tried again at the interval of
      // the configuration only: a restart of a few seconds does not reach
      // DOWN_AFTER_READS through the queries due every tick.
      if (!all && !serverDue && (due.length === 0 || this.error)) {
        return Promise.resolve(false);
      }
      this.pollingGeneration = this.generation;
      this.polling = this.read(due).finally(() => {
        this.polling = null;
      });
    }
    return this.polling;
  }

  async read(due) {
    const { generation } = this;
    const before = this.widgetSignature();
    let version = null;
    let error = null;
    const results = new Map();
    try {
      version = await this.client.version();
      for (let at = 0; at < due.length; at += QUERY_CONCURRENCY) {
        const batch = due.slice(at, at + QUERY_CONCURRENCY);
        const answers = await Promise.all(batch.map((query) => this.runQuery(query)));
        batch.forEach((query, index) => results.set(query.id, answers[index]));
      }
    } catch (caught) {
      error =
        caught instanceof SqlError
          ? caught
          : new SqlError(ERROR_KINDS.UNREACHABLE, String(caught?.message));
    }
    if (generation !== this.generation) {
      return false; // the configuration or the queries changed meanwhile
    }
    this.checkedAt = this.now();
    this.applyServer(version, error, results);
    await this.serverEvents();
    if (!this.error) {
      await this.queryEvents();
    }
    await this.publishStates();
    return before !== this.widgetSignature();
  }

  /** What the widget shows: it is refreshed when this changes. */
  widgetSignature() {
    return JSON.stringify([
      this.error?.kind,
      this.version,
      [...this.results].map(([id, result]) => [
        id,
        result.value,
        result.error?.kind ?? result.error?.value,
      ]),
    ]);
  }

  /**
   * One query: its value, or the reason it has none. A server error (no
   * answer, TLS, access, database) is thrown; a query error is kept.
   */
  async runQuery(query) {
    const at = this.now();
    try {
      const extracted = extractValue(
        await this.client.query(query.query),
        query.column,
        query.type,
      );
      return {
        value: extracted.value,
        error: extracted.error ? { value: extracted.error } : null,
        at,
      };
    } catch (err) {
      if (SERVER_ERRORS.has(err.kind)) {
        throw err;
      }
      return { value: null, error: asProblem(err), at };
    }
  }

  applyServer(version, error, results) {
    const place = placeOf(this.config);
    if (error) {
      if (this.error?.kind !== error.kind) {
        logger.warn(`Database ${place}: ${error.message}`);
      }
      this.error = error;
      this.failedReads += 1;
      this.downSince ??= this.now();
      return; // the last values stand
    }
    if (this.error) {
      logger.info(`Database ${place} answers again`);
    }
    if (version !== this.version) {
      logger.info(`${version} at ${place}`);
    }
    this.error = null;
    this.failedReads = 0;
    this.downSince = null;
    this.version = version;
    for (const [id, result] of results) {
      const query = this.queries.get(id);
      if (!query) {
        continue; // removed during the read
      }
      const previous = JSON.stringify(this.results.get(id)?.error ?? null);
      if (result.error && JSON.stringify(result.error) !== previous) {
        logger.warn(`Query "${query.name}": ${problemText(result.error, 'en')}`);
      }
      this.results.set(id, result);
    }
  }

  // --- Scene events --------------------------------------------------------------

  /**
   * "The database is unreachable" after DOWN_AFTER_READS failed cycles in a
   * row, "The database answers again" once, when it was announced. Marked
   * announced only once Gladys accepted the event (tried again next cycle).
   */
  async serverEvents() {
    const language = this.config.language;
    if (this.error && !this.events.down && this.failedReads >= DOWN_AFTER_READS) {
      const accepted = await this.fireEvent(TRIGGERS.DATABASE_DOWN, {
        error: problemText(this.error, language),
        error_kind: this.error.kind,
      });
      if (accepted) {
        this.events.down = { since: this.downSince ?? this.now(), place: placeKey(this.config) };
        this.save();
      }
    } else if (!this.error && this.events.down) {
      const accepted = await this.fireEvent(TRIGGERS.DATABASE_UP, {
        duration_minutes: Math.max(0, Math.round((this.now() - this.events.down.since) / 60_000)),
      });
      if (accepted) {
        this.events.down = null;
        this.save();
      }
    }
  }

  /** "A query fails" once per failure, "A query works again" once after it. */
  async queryEvents() {
    const { failing } = this.events;
    const language = this.config.language;
    let changed = false;
    for (const [id, query] of this.queries) {
      const result = this.results.get(id);
      if (!result) {
        continue;
      }
      // No row is not a failure (no data for now).
      const failed = Boolean(result.error);
      if (!failed && failing[id]) {
        const accepted = await this.fireEvent(TRIGGERS.QUERY_BACK, {
          name: query.name,
          value: result.value === null ? '' : String(result.value),
        });
        if (!accepted) {
          break; // Gladys refuses: try again at the next read
        }
        delete failing[id];
        changed = true;
      } else if (failed && !failing[id]) {
        const accepted = await this.fireEvent(TRIGGERS.QUERY_FAILED, {
          name: query.name,
          error: problemText(result.error, language),
        });
        if (!accepted) {
          break;
        }
        failing[id] = true;
        changed = true;
      }
    }
    for (const id of Object.keys(failing)) {
      if (!this.queries.has(id)) {
        delete failing[id];
        changed = true;
      }
    }
    if (changed) {
      this.save();
    }
  }

  /** @returns {Promise<boolean>} whether Gladys accepted the event */
  async fireEvent(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      logger.debug(`${key}: ${JSON.stringify(data)}`);
      this.failureLog.recover('event', 'Scene events accepted again');
      return true;
    } catch (err) {
      this.failureLog.fail('event', `Scene event refused: ${err.message}`);
      return false;
    }
  }

  // --- Devices -----------------------------------------------------------------

  deviceId() {
    return databaseIds(this.gladys).device;
  }

  isCreated() {
    const id = this.deviceId();
    return (this.gladys.devices ?? []).some((device) => device.external_id === id);
  }

  sortedQueries() {
    return [...this.queries.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Publish the Discovery list when it changed (a query added, the language…). */
  async publishDevices({ force = false } = {}) {
    if (!this.client) {
      if (force) {
        await this.sendDiscovered([]);
      }
      return;
    }
    // The product name ("MariaDB", "MySQL") comes from the first answer.
    if (this.checkedAt === 0 && !force) {
      return;
    }
    const device = buildDatabaseDevice(
      this.gladys,
      this.config,
      this.sortedQueries(),
      this.version,
    );
    await this.sendDiscovered([device], { force });
  }

  async sendDiscovered(devices, { force = false } = {}) {
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.failureLog.recover('discovered', 'Discovered devices accepted again');
    } catch (err) {
      this.failureLog.fail('discovered', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read again, publish the list again. */
  async rediscover() {
    await this.poll({ all: true });
    await this.publishDevices({ force: true });
  }

  /** The user added (or updated) the device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    if (device?.external_id !== this.deviceId()) {
      return;
    }
    await this.sendStates(this.values(), { force: true });
    this.transport = null;
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** The feature values to publish (null: nothing to publish). */
  values() {
    const ids = databaseIds(this.gladys);
    if (this.checkedAt === 0) {
      return [];
    }
    const values = [{ externalId: ids.feature(FEATURES.ONLINE), value: this.error ? 0 : 1 }];
    if (this.error) {
      return values; // the last values of the queries stand, with their age
    }
    if (this.version) {
      values.push({ externalId: ids.feature(FEATURES.VERSION), value: this.version });
    }
    for (const query of this.queries.values()) {
      const result = this.results.get(query.id);
      if (result && !result.error && result.value !== null) {
        values.push({ externalId: ids.feature(queryFeatureKey(query)), value: result.value });
      }
    }
    return values;
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  async publishStates() {
    if (this.isCreated()) {
      await this.sendStates(this.values());
    }
  }

  async sendStates(values, { force = false } = {}) {
    const now = this.now();
    const states = values
      .filter(({ externalId, value }) => {
        if (force || this.published.get(externalId) !== value) {
          return true;
        }
        return now - (this.publishedAt.get(externalId) ?? 0) >= this.timings.heartbeatMs;
      })
      .map(({ externalId, value }) => ({
        device_feature_external_id: externalId,
        // A text feature receives { text }, a number { state }.
        ...(typeof value === 'string' ? { text: value } : { state: value }),
      }));
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishStates(states);
      for (const state of states) {
        const value = state.text ?? state.state;
        this.published.set(state.device_feature_external_id, value);
        this.publishedAt.set(state.device_feature_external_id, now);
      }
      this.failureLog.recover('states', 'States accepted again');
    } catch (err) {
      this.failureLog.fail('states', `States refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged, { publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the device: local, "unreachable" while the database is. */
  async publishTransports() {
    if (!this.client || this.checkedAt === 0 || !this.isCreated()) {
      return;
    }
    const { LOCAL, UNREACHABLE } = DEVICE_TRANSPORTS;
    const transport = this.error ? UNREACHABLE : LOCAL;
    if (this.transport === transport) {
      return;
    }
    try {
      await this.gladys.publishTransports([{ external_id: this.deviceId(), transport }]);
      this.transport = transport;
      this.failureLog.recover('transports', 'Transports accepted again');
    } catch (err) {
      this.failureLog.fail('transports', `Transports refused: ${err.message}`);
    }
  }

  /** The error of the database, in one language: "Database: does not answer…". */
  errorText(language) {
    if (!this.error) {
      return '';
    }
    return labelled(this.config.database || 'SQL', problemText(this.error, language), language);
  }

  /** The status under the integration name. */
  connectionStatus() {
    const missing = missingField(this.config);
    if (missing) {
      return { connected: false, message: CONNECTION_TEXT[missing] };
    }
    if (!this.error) {
      return { connected: true };
    }
    return { connected: false, message: inEveryLanguage((language) => this.errorText(language)) };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.failureLog.recover('connection', 'Connection status accepted again');
    } catch (err) {
      this.failureLog.fail('connection', `Connection status refused: ${err.message}`);
    }
  }

  // --- Configuration actions ---------------------------------------------------------

  /** "Test the connection": read everything now, one line. */
  async testConnection() {
    await this.readDue({ all: true, publish: true });
    const status = this.connectionStatus();
    return inEveryLanguage((language) => {
      const text = REPORT_TEXT[language];
      if (!this.client) {
        return pick(status.message, language);
      }
      if (this.error) {
        return sentence([this.errorText(language)]);
      }
      const parts = [text.ok, this.version];
      parts.push(this.queries.size > 0 ? text.queries(this.queries.size) : text.noQuery);
      for (const query of this.sortedQueries()) {
        const problem = this.queryProblem(query, language);
        if (problem) {
          parts.push(labelled(query.name, problem, language));
        }
      }
      return sentence(parts);
    });
  }

  /** Why a query shows nothing, in one language; null when it has a value. */
  queryProblem(query, language) {
    const result = this.results.get(query.id);
    if (!result) {
      return null;
    }
    if (result.error) {
      return problemText(result.error, language);
    }
    return result.value === null ? pick(RESULT_TEXT.empty, language) : null;
  }

  /** "Add a query": checked by the guard and against the database, then saved. */
  async addQuery(fields) {
    const { query, error } = parseQueryFields(fields);
    if (error) {
      throw new AnswerError(QUERY_FIELD_TEXT[error]);
    }
    const checked = checkReadOnly(query.query, this.config.engine);
    if (checked.error) {
      const problem = asProblem(refusal(checked));
      throw new AnswerError(
        inEveryLanguage((language) =>
          REPORT_TEXT[language].refused(problemText(problem, language)),
        ),
      );
    }
    const existing = this.queries.get(query.id);
    const tooMany = () =>
      new AnswerError(inEveryLanguage((language) => REPORT_TEXT[language].tooMany(MAX_QUERIES)));
    if (!existing && this.queries.size >= MAX_QUERIES) {
      throw tooMany();
    }
    if (!this.client) {
      throw new AnswerError(this.connectionStatus().message ?? CONNECTION_TEXT.noHost);
    }
    let result;
    try {
      const { client } = this;
      result = await this.runQuery(query);
      if (client !== this.client) {
        // The configuration changed during the check: another database.
        throw new AnswerError(inEveryLanguage((language) => REPORT_TEXT[language].retry));
      }
    } catch (err) {
      if (err instanceof AnswerError) {
        throw err;
      }
      // The database does not answer: the query cannot be checked, refuse it.
      throw new AnswerError(
        inEveryLanguage((language) =>
          labelled(this.config.database, problemText(err, language), language),
        ),
      );
    }
    if (result.error && result.error.value === undefined) {
      // Refused by the database (syntax, rights, a write): not saved.
      throw new AnswerError(
        inEveryLanguage((language) =>
          REPORT_TEXT[language].refused(problemText(result.error, language)),
        ),
      );
    }
    if (!existing && this.queries.size >= MAX_QUERIES) {
      throw tooMany(); // another "Add a query" finished during the check
    }
    this.queries.set(query.id, query);
    this.generation += 1; // a read in progress does not know this query
    this.results.set(query.id, result);
    await this.save();
    logger.info(`Query ${existing ? 'updated' : 'added'}: ${query.name}`);
    const newFeature = !existing || queryFeatureKey(existing) !== queryFeatureKey(query);
    await this.publishDevices({ force: true });
    if (this.isCreated()) {
      await this.sendStates(this.values(), { force: true });
    }
    await this.queryEvents();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
    return inEveryLanguage((language) => {
      const text = REPORT_TEXT[language];
      const parts = [existing ? text.updated(query.name) : text.added(query.name)];
      const problem = this.queryProblem(query, language);
      parts.push(problem ?? text.value(result.value));
      if (!this.isCreated()) {
        parts.push(text.discovery);
      } else if (newFeature) {
        parts.push(text.update);
      }
      return sentence(parts);
    });
  }

  /** "Remove a query", by its name. */
  async removeQuery(fields) {
    const name = typeof fields?.name === 'string' ? fields.name.trim() : '';
    const query = name ? this.queries.get(queryId(name)) : null;
    if (!query) {
      throw new AnswerError(inEveryLanguage((language) => REPORT_TEXT[language].notFound(name)));
    }
    this.queries.delete(query.id);
    this.results.delete(query.id);
    delete this.events.failing[query.id];
    this.generation += 1;
    await this.save();
    logger.info(`Query removed: ${query.name}`);
    await this.publishDevices({ force: true });
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
    return inEveryLanguage((language) => {
      const text = REPORT_TEXT[language];
      return sentence([text.removed(query.name), text.queries(this.queries.size)]);
    });
  }

  /** A saved query, found by its name (case and spaces aside). */
  findQuery(name) {
    return typeof name === 'string' && name.trim() ? this.queries.get(queryId(name)) : undefined;
  }
}
