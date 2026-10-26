// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `values`.
//
// The use case: a glance at the figures the database holds (its size, the
// rows of a log table, the last measure of a table filled by another tool),
// without placing each feature on the dashboard. A first row for the
// database (its version, or why it does not answer), then one row per query:
// its value with its unit, or why it has none.
//
// The figures are sent as values, not bound to device features: the widget
// works before the device is added.
//
// Budget (8 components, 2 texts): one text while the database does not
// answer, one status list of ten rows at most, and a Refresh button.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_UNITS as UNIT, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from './hub.js';
import { QUERY_TYPES } from './queries.js';
import { pick } from './texts.js';

// Action key of the button: permanent once published.
export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

export const MAX_ROWS = 10;

export const TEXT = {
  configure: {
    en: 'Enter the address of your database in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre base de données dans la configuration de l'intégration.",
    de: 'Gib die Adresse deiner Datenbank in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su base de datos en la configuración de la integración.',
  },
  noQuery: {
    en: 'No query yet: use "Add a query" in the configuration of the integration.',
    fr: "Aucune requête : utilisez « Ajouter une requête » dans la configuration de l'intégration.",
    de: 'Noch keine Abfrage: Nutze „Abfrage hinzufügen“ in der Konfiguration der Integration.',
    es: 'Ninguna consulta: use «Añadir una consulta» en la configuración de la integración.',
  },
  database: { en: 'Database', fr: 'Base de données', de: 'Datenbank', es: 'Base de datos' },
  unreachable: { en: 'Unreachable', fr: 'Injoignable', de: 'Nicht erreichbar', es: 'Inaccesible' },
  waiting: {
    en: 'Not read yet',
    fr: 'Pas encore lue',
    de: 'Noch nicht gelesen',
    es: 'Aún no leída',
  },
  error: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
  noData: { en: 'No data', fr: 'Aucune donnée', de: 'Keine Daten', es: 'Sin datos' },
  yes: { en: 'Yes', fr: 'Oui', de: 'Ja', es: 'Sí' },
  no: { en: 'No', fr: 'Non', de: 'Nein', es: 'No' },
  more: { en: 'Others', fr: 'Autres', de: 'Weitere', es: 'Otras' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  refreshed: {
    en: 'Values read again.',
    fr: 'Valeurs relues.',
    de: 'Werte neu gelesen.',
    es: 'Valores leídos de nuevo.',
  },
};

const UNIT_SYMBOLS = {
  [UNIT.CELSIUS]: ' °C',
  [UNIT.PERCENT]: ' %',
  [UNIT.WATT]: ' W',
  [UNIT.KILOWATT_HOUR]: ' kWh',
  [UNIT.MEGABYTE]: ' MB',
};

const ICONS = {
  number: 'activity',
  temperature: 'thermometer',
  humidity: 'droplet',
  percent: 'percent',
  power: 'zap',
  energy: 'battery-charging',
  size: 'hard-drive',
  text: 'type',
  boolean: 'toggle-right',
};

const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

const refreshButton = (language) => ({
  type: 'button',
  label: pick(TEXT.refresh, language),
  icon: 'refresh-cw',
  style: 'secondary',
  action: { key: ACTIONS.REFRESH },
});

/** A value as shown: "21.5 °C" with the decimal separator of the language, "Yes", a text. */
export function formatValue(type, value, language) {
  const spec = QUERY_TYPES[type];
  if (spec.kind === 'text') {
    return String(value);
  }
  if (spec.kind === 'boolean') {
    return pick(value ? TEXT.yes : TEXT.no, language);
  }
  const text = new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(value);
  return `${text}${UNIT_SYMBOLS[spec.unit] ?? ''}`;
}

/** The row of one query: its value, or why there is none. */
function queryRow(hub, query, language) {
  const result = hub.results.get(query.id);
  const label = fit(query.name, 40);
  if (result?.error) {
    return {
      label,
      value: pick(TEXT.error, language),
      icon: 'alert-triangle',
      color: WIDGET_COLORS.DANGER,
    };
  }
  if (!result || result.value === null) {
    return {
      label,
      value: pick(result ? TEXT.noData : TEXT.waiting, language),
      icon: 'minus-circle',
      color: WIDGET_COLORS.NEUTRAL,
    };
  }
  return {
    label,
    value: fit(formatValue(query.type, result.value, language), 40),
    icon: ICONS[query.type],
    color: WIDGET_COLORS.INFO,
  };
}

async function get(hub, { language = 'en' }) {
  if (!hub.client) {
    return {
      ttl_seconds: 300,
      components: [{ type: 'text', variant: 'body', text: pick(TEXT.configure, language) }],
    };
  }
  const components = [];
  const errorText = hub.errorText(language);
  if (errorText) {
    components.push({ type: 'text', variant: 'body', text: fit(errorText, 200) });
  }
  const rows = [
    {
      label: fit(`${pick(TEXT.database, language)} ${hub.config.database}`, 40),
      value: fit(
        hub.error
          ? pick(TEXT.unreachable, language)
          : (hub.version ?? pick(TEXT.waiting, language)),
        40,
      ),
      icon: 'database',
      color: hub.error
        ? WIDGET_COLORS.DANGER
        : hub.version
          ? WIDGET_COLORS.SUCCESS
          : WIDGET_COLORS.NEUTRAL,
    },
    ...hub.sortedQueries().map((query) => queryRow(hub, query, language)),
  ];
  const items = rows.length > MAX_ROWS ? rows.slice(0, MAX_ROWS - 1) : rows;
  if (rows.length > items.length) {
    items.push({
      label: pick(TEXT.more, language),
      value: `+${rows.length - items.length}`,
      icon: 'more-horizontal',
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  components.push({ type: 'status', items });
  if (hub.queries.size === 0) {
    components.push({ type: 'text', variant: 'body', text: pick(TEXT.noQuery, language) });
  }
  components.push(refreshButton(language));
  const intervalSeconds = Math.round((hub.config?.pollIntervalMs ?? 60_000) / 1000);
  return { ttl_seconds: Math.min(300, Math.max(30, intervalSeconds)), components };
}

async function action(hub, { actionKey }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  await hub.readDue({ all: true });
  return { message: TEXT.refreshed };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
