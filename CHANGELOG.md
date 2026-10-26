# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- SQL in Gladys: your queries on a PostgreSQL, MariaDB or MySQL database
  become features of one device, added with the "Add a query" configuration
  action (name, SELECT, column, type, interval); types number, temperature,
  humidity, percentage, power, energy, size, text and yes/no.
- Read-only, three times over: only a single SELECT (or WITH … SELECT) is
  accepted, every query runs in a read-only transaction with a time limit,
  and the documentation shows how to create a user who may only read.
- "Reachable" and "Version" features of the database, and an "unreachable"
  badge while it does not answer.
- Scene triggers "The database is unreachable", "The database answers again",
  "A query fails" and "A query works again", never repeated nor forgotten
  across a restart.
- Scene action "Read an SQL query now": a saved query or a one-off SELECT,
  with its value and its text.
- Dashboard widget "SQL values": the database and the last value of every
  query.
- "Test the connection", TLS (any certificate, or a valid one), texts and
  documentation in English, French, German and Spanish.
