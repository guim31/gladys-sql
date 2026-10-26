// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// The values of the queries are already device states (scene conditions,
// "read a device value"), refreshed at their interval. This action reads one
// now, in a scene: a figure fresh to the second before a message ("12 rows
// added today"), or a one-off SELECT that is not worth a feature. The same
// guard and read-only transaction apply.
// -----------------------------------------------------------------------------

import { MAX_QUERY_LENGTH, extractValue } from './queries.js';
import { ACTION_TEXT, CONNECTION_TEXT, labelled, pick, problemText } from './texts.js';
import { formatValue } from './widgets.js';

export const SCENE_ACTIONS = {
  async read_query(hub, { fields = {} }) {
    const language = hub.config?.language;
    if (!hub.client) {
      throw new Error(pick(hub.connectionStatus?.().message ?? CONNECTION_TEXT.noHost, language));
    }
    const typed = typeof fields.query === 'string' ? fields.query.trim() : '';
    if (!typed || typed.length > MAX_QUERY_LENGTH) {
      throw new Error(pick(ACTION_TEXT.noQuery, language));
    }
    // The name of a saved query (its column and type), or a SELECT (its first column, a number or a text).
    const saved = hub.findQuery(typed);
    const query = saved ?? { query: typed, column: '', type: 'text' };
    let result;
    try {
      result = await hub.client.query(query.query);
    } catch (err) {
      throw new Error(labelled(saved?.name ?? 'SQL', problemText(err, language), language), {
        cause: err,
      });
    }
    const extracted = extractValue(result, query.column, query.type);
    if (extracted.error) {
      throw new Error(problemText({ value: extracted.error }, language));
    }
    const { value } = extracted;
    if (value === null) {
      return { value: 0, text: '' };
    }
    const number = typeof value === 'number' ? value : Number(value);
    return {
      // Not a number (a text): 0, and `text` holds it.
      value:
        Number.isFinite(number) && String(value).trim() !== '' ? Math.round(number * 100) / 100 : 0,
      text: saved ? formatValue(saved.type, value, language) : String(value),
    };
  },
};
