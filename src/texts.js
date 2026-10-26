// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// feature names, connection status, errors, the configuration action
// reports, scene event variables, scene action messages. Four languages, the
// four of the Gladys interface; German says "du", Spanish "usted".
// test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './sql/client.js';
import { GUARD_ERRORS } from './sql/guard.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const FEATURE_TEXT = {
  online: { en: 'Reachable', fr: 'Joignable', de: 'Erreichbar', es: 'Accesible' },
  version: { en: 'Version', fr: 'Version', de: 'Version', es: 'Versión' },
};

export const CONNECTION_TEXT = {
  noHost: {
    en: 'Enter the address of your database in the configuration.',
    fr: "Saisissez l'adresse de votre base de données dans la configuration.",
    de: 'Gib die Adresse deiner Datenbank in der Konfiguration ein.',
    es: 'Introduzca la dirección de su base de datos en la configuración.',
  },
  invalidHost: {
    en: 'Address not understood, e.g. 192.168.1.2 or db.home.lan',
    fr: 'Adresse incomprise, ex. 192.168.1.2 ou db.maison.lan',
    de: 'Adresse nicht verstanden, z. B. 192.168.1.2 oder db.home.lan',
    es: 'Dirección no válida, p. ej. 192.168.1.2 o db.casa.lan',
  },
  noDatabase: {
    en: 'Enter the name of the database in the configuration.',
    fr: 'Saisissez le nom de la base de données dans la configuration.',
    de: 'Gib den Namen der Datenbank in der Konfiguration ein.',
    es: 'Introduzca el nombre de la base de datos en la configuración.',
  },
  noUser: {
    en: 'Enter the user in the configuration.',
    fr: "Saisissez l'utilisateur dans la configuration.",
    de: 'Gib den Benutzer in der Konfiguration ein.',
    es: 'Introduzca el usuario en la configuración.',
  },
};

// One short explanation per error kind (src/sql/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'does not answer: check the address and the port',
    fr: "ne répond pas : vérifiez l'adresse et le port",
    de: 'antwortet nicht: Prüfe Adresse und Port',
    es: 'no responde: compruebe la dirección y el puerto',
  },
  [ERROR_KINDS.TLS]: {
    en: 'TLS refused: change the "Encryption (TLS)" option',
    fr: "TLS refusé : changez l'option « Chiffrement (TLS) »",
    de: 'TLS abgelehnt: Ändere die Option „Verschlüsselung (TLS)“',
    es: 'TLS rechazado: cambie la opción «Cifrado (TLS)»',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'access refused: check the user and the password',
    fr: "accès refusé : vérifiez l'utilisateur et le mot de passe",
    de: 'Zugriff verweigert: Prüfe Benutzer und Passwort',
    es: 'acceso denegado: compruebe el usuario y la contraseña',
  },
  [ERROR_KINDS.DATABASE]: {
    en: 'database not found: check its name',
    fr: 'base de données introuvable : vérifiez son nom',
    de: 'Datenbank nicht gefunden: Prüfe ihren Namen',
    es: 'base de datos no encontrada: compruebe su nombre',
  },
  [ERROR_KINDS.TIMEOUT]: {
    en: 'too slow: time limit reached',
    fr: 'trop lente : délai maximal atteint',
    de: 'zu langsam: Zeitlimit erreicht',
    es: 'demasiado lenta: tiempo máximo alcanzado',
  },
  [ERROR_KINDS.READ_ONLY]: {
    en: 'refused by the database: it would write',
    fr: 'refusée par la base : elle écrirait',
    de: 'von der Datenbank abgelehnt, da sie schreiben würde',
    es: 'rechazada por la base de datos: escribiría',
  },
  [ERROR_KINDS.REFUSED]: {
    en: 'refused: one SELECT only',
    fr: 'refusée : un seul SELECT',
    de: 'abgelehnt: nur ein SELECT',
    es: 'rechazada: un solo SELECT',
  },
  [ERROR_KINDS.QUERY]: {
    en: 'error in the query',
    fr: 'erreur dans la requête',
    de: 'Fehler in der Abfrage',
    es: 'error en la consulta',
  },
};

// Why the integration refuses a text (src/sql/guard.js GUARD_ERRORS).
export const GUARD_TEXT = {
  [GUARD_ERRORS.EMPTY]: {
    en: 'the query is empty',
    fr: 'la requête est vide',
    de: 'die Abfrage ist leer',
    es: 'la consulta está vacía',
  },
  [GUARD_ERRORS.NOT_SELECT]: {
    en: 'only SELECT (or WITH … SELECT) is accepted',
    fr: 'seul SELECT (ou WITH … SELECT) est accepté',
    de: 'nur SELECT (oder WITH … SELECT) ist erlaubt',
    es: 'solo se acepta SELECT (o WITH … SELECT)',
  },
  [GUARD_ERRORS.MULTIPLE]: {
    en: 'one query only: remove the inner ";"',
    fr: 'une seule requête : retirez le « ; » intérieur',
    de: 'nur eine Abfrage: Entferne das „;“ in der Mitte',
    es: 'una sola consulta: quite el «;» interior',
  },
  [GUARD_ERRORS.FORBIDDEN]: {
    en: 'this word writes or locks, it is refused:',
    fr: 'ce mot écrit ou verrouille, il est refusé :',
    de: 'dieses Wort schreibt oder sperrt, es wird abgelehnt:',
    es: 'esta palabra escribe o bloquea, se rechaza:',
  },
  [GUARD_ERRORS.BACKSLASH]: {
    en: 'a backslash \\ is refused (its meaning depends on the server)',
    fr: 'une barre oblique inverse \\ est refusée (son sens dépend du serveur)',
    de: 'ein Backslash \\ wird abgelehnt (seine Bedeutung hängt vom Server ab)',
    es: 'se rechaza una barra invertida \\ (su sentido depende del servidor)',
  },
  [GUARD_ERRORS.UNTERMINATED]: {
    en: 'a quote or a comment is not closed',
    fr: "un guillemet ou un commentaire n'est pas fermé",
    de: 'ein Anführungszeichen oder Kommentar ist nicht geschlossen',
    es: 'unas comillas o un comentario no están cerrados',
  },
};

// Why a query has no value (src/queries.js VALUE_ERRORS), or none for now.
export const RESULT_TEXT = {
  column: {
    en: 'this column is not in the result',
    fr: "cette colonne n'est pas dans le résultat",
    de: 'diese Spalte ist nicht im Ergebnis',
    es: 'esta columna no está en el resultado',
  },
  not_number: {
    en: 'the value is not a number: choose the Text type',
    fr: "la valeur n'est pas un nombre : choisissez le type Texte",
    de: 'der Wert ist keine Zahl: Wähle den Typ Text',
    es: 'el valor no es un número: elija el tipo Texto',
  },
  not_boolean: {
    en: 'the value is not yes/no (1/0, true/false)',
    fr: "la valeur n'est pas oui/non (1/0, true/false)",
    de: 'der Wert ist nicht ja/nein (1/0, true/false)',
    es: 'el valor no es sí/no (1/0, true/false)',
  },
  empty: {
    en: 'no row (or NULL) for now',
    fr: 'aucune ligne (ou NULL) pour le moment',
    de: 'im Moment keine Zeile (oder NULL)',
    es: 'ninguna fila (o NULL) por ahora',
  },
};

// Reports of the configuration actions ("Test the connection", "Add a
// query", "Remove a query"). Functions: the parts that carry a value.
export const REPORT_TEXT = {
  en: {
    ok: 'OK',
    queries: (count) => `${count} query(ies)`,
    added: (name) => `Query "${name}" added`,
    updated: (name) => `Query "${name}" updated`,
    removed: (name) => `Query "${name}" removed`,
    value: (value) => `value: ${value}`,
    discovery: 'add the database from the Discover tab',
    update: 'click "Update" on the database in the Discover tab',
    notFound: (name) => `No query named "${name}".`,
    tooMany: (max) => `${max} queries at most: remove one first.`,
    refused: (detail) => `Query refused: ${detail}`,
    noQuery: 'no query yet: use "Add a query"',
    retry: 'The configuration changed meanwhile: add the query again.',
  },
  fr: {
    ok: 'OK',
    queries: (count) => `${count} requête(s)`,
    added: (name) => `Requête « ${name} » ajoutée`,
    updated: (name) => `Requête « ${name} » modifiée`,
    removed: (name) => `Requête « ${name} » supprimée`,
    value: (value) => `valeur : ${value}`,
    discovery: "ajoutez la base depuis l'onglet Découverte",
    update: "cliquez sur « Mettre à jour » sur la base dans l'onglet Découverte",
    notFound: (name) => `Aucune requête nommée « ${name} ».`,
    tooMany: (max) => `${max} requêtes au plus : supprimez-en une d'abord.`,
    refused: (detail) => `Requête refusée : ${detail}`,
    noQuery: 'aucune requête : utilisez « Ajouter une requête »',
    retry: 'La configuration a changé entre-temps : ajoutez de nouveau la requête.',
  },
  de: {
    ok: 'OK',
    queries: (count) => `${count} Abfrage(n)`,
    added: (name) => `Abfrage „${name}“ hinzugefügt`,
    updated: (name) => `Abfrage „${name}“ geändert`,
    removed: (name) => `Abfrage „${name}“ entfernt`,
    value: (value) => `Wert: ${value}`,
    discovery: 'füge die Datenbank im Tab „Entdecken“ hinzu',
    update: 'klicke im Tab „Entdecken“ bei der Datenbank auf „Aktualisieren“',
    notFound: (name) => `Keine Abfrage namens „${name}“.`,
    tooMany: (max) => `Höchstens ${max} Abfragen: Entferne zuerst eine.`,
    refused: (detail) => `Abfrage abgelehnt: ${detail}`,
    noQuery: 'noch keine Abfrage: Nutze „Abfrage hinzufügen“',
    retry: 'Die Konfiguration hat sich inzwischen geändert: Füge die Abfrage erneut hinzu.',
  },
  es: {
    ok: 'OK',
    queries: (count) => `${count} consulta(s)`,
    added: (name) => `Consulta «${name}» añadida`,
    updated: (name) => `Consulta «${name}» modificada`,
    removed: (name) => `Consulta «${name}» eliminada`,
    value: (value) => `valor: ${value}`,
    discovery: 'añada la base de datos desde la pestaña Descubrir',
    update: 'pulse «Actualizar» en la base de datos en la pestaña Descubrir',
    notFound: (name) => `Ninguna consulta se llama «${name}».`,
    tooMany: (max) => `${max} consultas como máximo: elimine una antes.`,
    refused: (detail) => `Consulta rechazada: ${detail}`,
    noQuery: 'ninguna consulta: use «Añadir una consulta»',
    retry: 'La configuración ha cambiado mientras tanto: añada de nuevo la consulta.',
  },
};

// Why "Add a query" refuses its fields (src/queries.js QUERY_ERRORS).
export const QUERY_FIELD_TEXT = {
  name: {
    en: 'Give the query a name (60 characters at most).',
    fr: 'Donnez un nom à la requête (60 caractères au plus).',
    de: 'Gib der Abfrage einen Namen (höchstens 60 Zeichen).',
    es: 'Dé un nombre a la consulta (60 caracteres como máximo).',
  },
  query: {
    en: 'Enter the query (4000 characters at most).',
    fr: 'Saisissez la requête (4000 caractères au plus).',
    de: 'Gib die Abfrage ein (höchstens 4000 Zeichen).',
    es: 'Introduzca la consulta (4000 caracteres como máximo).',
  },
  column: {
    en: 'A column name has 64 characters at most.',
    fr: 'Un nom de colonne a 64 caractères au plus.',
    de: 'Ein Spaltenname hat höchstens 64 Zeichen.',
    es: 'Un nombre de columna tiene 64 caracteres como máximo.',
  },
  type: {
    en: 'Choose a type in the list.',
    fr: 'Choisissez un type dans la liste.',
    de: 'Wähle einen Typ aus der Liste.',
    es: 'Elija un tipo de la lista.',
  },
  interval: {
    en: 'Choose an interval in the list.',
    fr: 'Choisissez un intervalle dans la liste.',
    de: 'Wähle ein Intervall aus der Liste.',
    es: 'Elija un intervalo de la lista.',
  },
};

// Scene action messages (shown in Gladys).
export const ACTION_TEXT = {
  noQuery: {
    en: 'Enter the name of a query, or a SELECT.',
    fr: "Saisissez le nom d'une requête, ou un SELECT.",
    de: 'Gib den Namen einer Abfrage oder ein SELECT ein.',
    es: 'Introduzca el nombre de una consulta, o un SELECT.',
  },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];
/** The parts of a report, in one language: "a, b, c." */
export const sentence = (parts) => `${parts.filter(Boolean).join(', ')}.`;

/** Why a query failed, in one language (an SqlError, or a value error key). */
export function problemText(error, language) {
  if (!error) {
    return '';
  }
  if (error.value) {
    return pick(RESULT_TEXT[error.value], language);
  }
  if (error.kind === ERROR_KINDS.REFUSED) {
    const reason = pick(GUARD_TEXT[error.reason] ?? ERROR_TEXT.refused, language);
    return error.detail ? `${reason} ${error.detail}` : reason;
  }
  const text = pick(ERROR_TEXT[error.kind] ?? ERROR_TEXT.query, language);
  return error.kind === ERROR_KINDS.QUERY && error.detail ? `${text} (${error.detail})` : text;
}
