# SQL

Turn your SQL queries into Gladys sensors: the size of a database, the rows
of a log table, the last measure of a table filled by another tool (a weather
station, an energy meter, a script). The queries you choose run on your
**PostgreSQL**, **MariaDB** or **MySQL** database at the interval you choose,
and your scenes react when the database stops answering or a query fails. A
dashboard widget shows the values at a glance.

The integration only reads, and checks it three times: it refuses any text
that is not a single `SELECT`, every query runs in a read-only transaction
that the database itself enforces, and you give it a user who may only read.

Tested against real PostgreSQL 17, MariaDB 11 and MySQL 8 servers (official
Docker images, real tables, a read-only user, a database stopped for real).
Feedback welcome:
[github.com/guim31/gladys-sql/issues](https://github.com/guim31/gladys-sql/issues).

## What you need

- Gladys Assistant 5.1.0 or later.
- A PostgreSQL (10 or later), MariaDB (10.3 or later) or MySQL (5.7 or later)
  database, reachable from the Gladys machine (port 5432 or 3306).
- A user of this database **who may only read**. Create one, as the
  administrator of the database:

PostgreSQL:

```sql
CREATE USER gladys PASSWORD 'a long password';
GRANT CONNECT ON DATABASE home TO gladys;
GRANT USAGE ON SCHEMA public TO gladys;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO gladys;
```

MariaDB and MySQL:

```sql
CREATE USER 'gladys'@'%' IDENTIFIED BY 'a long password';
GRANT SELECT ON home.* TO 'gladys'@'%';
```

## Getting started

### 1. Configure the integration

In Gladys, open the integration and fill in:

- **Database type**: PostgreSQL, or MariaDB or MySQL.
- **Address** of the server, e.g. `192.168.1.2`, and its **Port** if it is not
  the default one (5432 for PostgreSQL, 3306 for MariaDB and MySQL).
- **Database**, **User** and **Password**.
- **Encryption (TLS)**: **No** on your home network; **Yes, any certificate
  (self-signed)** for a server with its own certificate; **Yes, with a valid
  certificate** for a database on the Internet.
- **Refresh interval**: how often the connection is checked, and the queries
  without their own interval run (1 minute by default, up to 1 hour).
- **Time limit per query**: beyond it, the database stops the query (10
  seconds by default).
- **Language of the messages**: of the feature names, scene results and
  messages.

**Test the connection** says whether the database answers, its version, and
the state of every query.

### 2. Add your queries

**Add a query** asks for:

- **Name**: the name of its feature in Gladys. The same name again replaces
  the query.
- **SQL query (SELECT)**: a single `SELECT` or `WITH … SELECT`. The value is
  read in the **first row**: sort and limit (`ORDER BY … DESC LIMIT 1`), or
  aggregate (`count(*)`, `max()`, `avg()`).
- **Column (optional)**: the column to read; empty, the first one.
- **Type**: Number (no unit), Temperature (°C), Humidity (%), Percentage (%),
  Power (W), Energy (kWh), Size (MB), Text, or Yes / no (1/0, true/false).
- **Interval (optional)**: from 30 seconds to 1 hour; empty, the refresh
  interval of the configuration.

The query is tried before it is saved: the message gives its value, or why the
database refuses it. **Remove a query** takes its name.

Examples:

```sql
-- PostgreSQL: size of the database, in MB (type Size)
SELECT pg_database_size(current_database()) / 1000000.0
-- MariaDB, MySQL: size of the database, in MB (type Size)
SELECT SUM(data_length + index_length) / 1000000 FROM information_schema.tables WHERE table_schema = DATABASE()
-- Rows added today (type Number)
SELECT count(*) FROM events WHERE created_at >= CURRENT_DATE
-- Last temperature of a measures table (type Temperature)
SELECT temperature FROM measures ORDER BY created_at DESC LIMIT 1
-- Did last night's backup work? (type Yes / no)
SELECT ok FROM backups ORDER BY finished_at DESC LIMIT 1
```

### 3. Add the device

In the **Discover** tab, add the database. After adding or removing queries,
click **Update** on it there: Gladys adds the new features.

## The devices

One device for the database, named after it (e.g. `PostgreSQL home`):

- **Reachable**: 1 while the database answers, 0 when it does not.
- **Version**: the server version, e.g. `PostgreSQL 17.6`, `MariaDB 11.4.3`.
- One feature per query, of its type. A row missing, or a `NULL` value, leaves
  the last value in place.

The badge of the device turns to "unreachable" while the database does not
answer.

## Dashboard

The **SQL values** widget shows the database (its version, or why it does not
answer), then the last value of each query: ten rows at most. **Refresh**
reads everything again now.

## Scenes

### Triggers

- **The database is unreachable**: two reads in a row fail (no answer, access
  refused, database not found, TLS refused). Variables: the error, and its key
  (`unreachable`, `auth`, `database`, `tls`).
- **The database answers again**: after an outage announced; variable: its
  duration in minutes.
- **A query fails**: an error in the query, the time limit reached, or a value
  that does not fit its type. Once, until it works again. Filter: the name of
  the query (empty: any).
- **A query works again**: the query gives a value again; variable: the value.

No row is not a failure: a query whose result is empty for now fires nothing.

### Actions

**Read an SQL query now** runs a saved query (give its name) or a `SELECT`
(read in its first column), and gives **value** (a number, 0 if the value is
not one) and **text** (the value with its unit, or the text). A scene can use
them in a message or a condition.

### Scene ideas

- Every morning, send "{{text}} rows added to the log yesterday", read by
  **Read an SQL query now**.
- **The database is unreachable**: send a message with the error, and turn on
  a red light until **The database answers again**.
- When the "Backup ok" feature is 0 at 8:00, send a reminder to check the
  backup.

## Troubleshooting

- **"does not answer"**: check the address and the port, and that the server
  listens on the network (`listen_addresses` in PostgreSQL, `bind-address` in
  MariaDB and MySQL) and accepts the Gladys machine (`pg_hba.conf` in
  PostgreSQL).
- **"access refused"**: check the user and the password; with MariaDB or
  MySQL, the user must be allowed from the address of the Gladys machine
  (`'gladys'@'%'`).
- **"database not found"**: check its name (and, with MariaDB or MySQL, that
  the user has a right on it).
- **"TLS refused"**: change **Encryption (TLS)**: the server does not offer it,
  requires it, or its certificate is not valid.
- **"only SELECT (or WITH … SELECT) is accepted"**, **"this word writes or
  locks"**: the integration refuses what could write (`INSERT`, `UPDATE`,
  `DELETE`, `SELECT … INTO`, `FOR UPDATE`, `nextval()`…). Quote a column that
  bears such a name (`"update"` in PostgreSQL, `` `update` `` in MySQL).
- **"refused by the database: it would write"**: the query calls a function
  that writes; the read-only transaction stopped it.
- **"too slow"**: add an index, bound the query (`WHERE created_at > now() -
interval '1 day'`), or raise the time limit.
- **Logs**: in Gladys, the integration page shows its logs. Add
  `LOG_LEVEL=debug` for every read.

## Limits

- One database per installation, 20 queries; one value per query (the first
  row).
- Read only: nothing is ever written into the database. A backslash (`\`)
  is refused in a query: its meaning depends on the server settings.
- PostgreSQL, MariaDB and MySQL only (not SQL Server, Oracle or SQLite).
- The queries are stored in the data volume of the integration: reinstalling
  it from scratch loses them (add them again with the same names: same
  features).
- Numbers are rounded to two decimals, texts cut at 250 characters.
- Tested with the test tools of the Gladys SDK and real database servers, not
  yet in a real Gladys instance: feedback welcome.
