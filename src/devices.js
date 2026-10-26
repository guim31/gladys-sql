// -----------------------------------------------------------------------------
// The Gladys device, proposed in the Discovery tab (the user adds it, nothing
// is created on their behalf): one device for the configured database, whose
// identity does not depend on the address (a database moved to another host
// keeps its device and history). Its features:
//
//   online        input/binary   1 the database answers, 0 it does not
//   version       text/text      "PostgreSQL 17.6", "MariaDB 11.4.3"…
//   <type>_<id>   one per query  of the type chosen for the query
//
// Published with should_poll: false: the integration reads the database on
// its own timer (src/hub.js), at the intervals chosen.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORY,
  DEVICE_FEATURE_TYPES as TYPE,
} from '@gladysassistant/integration-sdk';
import { ENGINES } from './sql/client.js';
import { QUERY_TYPES } from './queries.js';
import { FEATURE_TEXT, pick } from './texts.js';

export const DATABASE_TYPE = 'database';
// One database per integration: a fixed platform id.
export const DATABASE_ID = 'main';

export const FEATURES = Object.freeze({ ONLINE: 'online', VERSION: 'version' });
export const PARAMS = Object.freeze({ ENGINE: 'ENGINE', DATABASE: 'DATABASE' });
const MAX_FEATURE_NAME = 60;

export const ENGINE_NAMES = {
  [ENGINES.POSTGRES]: 'PostgreSQL',
  [ENGINES.MYSQL]: 'MariaDB / MySQL',
};

export const databaseIds = (gladys) => gladys.externalIds(DATABASE_TYPE, DATABASE_ID);

/** Feature key of a query: the type is part of it (a new type, a new feature). */
export const queryFeatureKey = (query) => `${query.type}_${query.id}`;

const readOnly = { read_only: true, has_feedback: false };

/**
 * The discovery payload of the database.
 * @param {object} gladys SDK client
 * @param {object} config normalized configuration
 * @param {object[]} queries sorted by name
 * @param {string|null} [version] "MySQL 8.4.2": the product names the device
 */
export function buildDatabaseDevice(gladys, config, queries, version = null) {
  const ids = databaseIds(gladys);
  const language = config.language;
  const taken = new Set();
  // Distinct names on the device: a query called "Version" gets a suffix.
  const unique = (base) => {
    const cut = base.slice(0, MAX_FEATURE_NAME);
    let name = cut;
    for (let index = 2; taken.has(name.toLowerCase()); index += 1) {
      name = `${cut.slice(0, MAX_FEATURE_NAME - 5)} (${index})`;
    }
    taken.add(name.toLowerCase());
    return name;
  };
  const features = [
    {
      name: unique(pick(FEATURE_TEXT.online, language)),
      external_id: ids.feature(FEATURES.ONLINE),
      category: CATEGORY.INPUT,
      type: TYPE.SENSOR.BINARY,
      ...readOnly,
      keep_history: true,
      min: 0,
      max: 1,
    },
    {
      name: unique(pick(FEATURE_TEXT.version, language)),
      external_id: ids.feature(FEATURES.VERSION),
      category: CATEGORY.TEXT,
      type: TYPE.TEXT.TEXT,
      ...readOnly,
      keep_history: false,
      min: 0,
      max: 0,
    },
  ];
  for (const query of queries) {
    const spec = QUERY_TYPES[query.type];
    features.push({
      name: unique(query.name),
      external_id: ids.feature(queryFeatureKey(query)),
      category: spec.category,
      type: spec.type,
      ...(spec.unit ? { unit: spec.unit } : {}),
      ...readOnly,
      keep_history: true,
      min: spec.min,
      max: spec.max,
    });
  }
  return {
    name: `${version?.split(' ')[0] ?? ENGINE_NAMES[config.engine].split(' ')[0]} ${config.database}`.slice(
      0,
      80,
    ),
    external_id: ids.device,
    model: ENGINE_NAMES[config.engine],
    should_poll: false,
    params: [
      { name: PARAMS.ENGINE, value: config.engine },
      { name: PARAMS.DATABASE, value: config.database.slice(0, 255) },
    ],
    features,
  };
}
