# SQL for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration that turns your
SQL queries on a **PostgreSQL**, **MariaDB** or **MySQL** database into Gladys
sensors: the size of a database, the rows of a log table, the last measure of
a table filled by another tool. Scenes also react when the database stops
answering or a query fails, and a dashboard widget shows the values. It is
the Gladys counterpart of the Home Assistant "SQL" integration.

It only reads: a single `SELECT` is accepted, every query runs in a read-only
transaction, and you give it a user who may only read.

## Features

- **One device for the database**: a **Reachable** feature, the server
  **Version**, and one feature per query, added with the **Add a query**
  action of the configuration (name, SELECT, column, type, interval).
- **Types**: number, temperature, humidity, percentage, power, energy, size
  (MB), text and yes/no; the value is read in the first row.
- **Intervals**: 30 seconds to 1 hour, per query or for all.
- **Read-only, three times over**: the integration refuses anything but a
  single `SELECT` (or `WITH … SELECT`), and the words that write or lock in
  it; every query runs in a read-only transaction, with a time limit on the
  server; the documentation shows how to create a read-only user.
- **Scene triggers**: the database is unreachable (two failed reads in a row),
  the database answers again (with the outage length), a query fails, a query
  works again (filter: its name).
- **Scene action**: read an SQL query now, a saved one or a one-off SELECT.
- **Widget**: the database and the last value of every query.
- TLS off, on with any certificate, or on with a valid one.
- Messages and documentation in English, French, German and Spanish.

## Requirements

- Gladys Assistant 5.1.0 or later.
- PostgreSQL 10+, MariaDB 10.3+ or MySQL 5.7+, reachable from Gladys, and a
  user with read rights only.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-sql`
   (or install **SQL** from the catalog once it is listed).
2. In **Configuration**, choose the database type, enter the address, the
   database, the user and the password. Save, then click **Test the
   connection**.
3. Still in **Configuration**, add your queries with **Add a query**.
4. Open the **Discover** tab and add the database.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

Every 15 seconds the integration looks for what is due: the database at the
refresh interval of the configuration (1 minute by default), each query at its
own. A read opens a connection, reads `version()`, then runs each query due on
a connection of its own (three at a time): `BEGIN READ ONLY` (PostgreSQL, in a
session that is read-only by default, through the extended protocol that
refuses a second statement) or `START TRANSACTION READ ONLY` (MariaDB, MySQL,
without multiple statements), the time limit (`statement_timeout`,
`max_statement_time`, `max_execution_time`), the query, `ROLLBACK`. Nothing
stays open between reads. The states are sent only when they change (and every
6 hours); the scene events are sent whether the device is added or not. The
queries and the events already announced are kept in `/data`.

Drivers: [`pg`](https://node-postgres.com/) and
[`mysql2`](https://sidorares.github.io/node-mysql2/).

## Checked on real databases

On 26/10/2026, against the official Docker images of PostgreSQL 17.11,
MariaDB 11.8.9 and MySQL 8.4.13 with real tables: a read-only user, numbers,
texts, booleans, dates, `NULL` and empty results; a write refused by the
guard of the integration **and**, the guard bypassed with a user allowed to
write, by the read-only transaction (no row written); the time limit; a wrong
password, an unknown database, a closed port, a server stopped then restarted.
The answers are kept as anonymized fixtures in
[`test/fixtures/real`](test/fixtures/real). The image was also run with the
sandbox constraints of Gladys against these servers. Not yet run in a real
Gladys instance: feedback welcome.

## Limitations

- One database per integration, 20 queries, one value per query.
- PostgreSQL, MariaDB and MySQL only.
- Numbers rounded to two decimals, texts cut at 250 characters.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests run against the fake Gladys of the SDK and replay the real answers
of the three servers: no network, no database needed. See
[`CLAUDE.md`](CLAUDE.md) for the rules of the repository.

## Credits

- Inspired by the [Home Assistant SQL integration](https://www.home-assistant.io/integrations/sql/)
  (Apache 2.0); no code taken from it.
- Built from the official
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js),
  with the shape of [guim31/gladys-influxdb](https://github.com/guim31/gladys-influxdb).
- Cover: the official PostgreSQL elephant
  ([Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Postgresql_elephant.svg))
  and MariaDB logo
  ([Wikimedia Commons](https://commons.wikimedia.org/wiki/File:MariaDB_colour_logo.svg)).

Not affiliated with the PostgreSQL Global Development Group, the MariaDB
Foundation, MariaDB plc or Oracle (MySQL). PostgreSQL, MariaDB and MySQL are
trademarks of their owners.

## License

[Apache 2.0](LICENSE).
