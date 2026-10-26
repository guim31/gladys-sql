# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the database password is a `secret` field of the Gladys
  configuration. The integration reads it from Gladys at startup, keeps it in
  memory, sends it only to the database server of the configuration (through
  the PostgreSQL or MariaDB / MySQL protocol, encrypted when TLS is on), and
  never writes it to `/data` nor to the logs. A host with credentials inside
  (`user:pass@host`) is refused.
- **Stored in `/data`**: `sql-state.json`, the queries added by the user
  (name, SELECT text, column, type, interval) and the scene events already
  announced (database unreachable since when, failing queries). No secret, no
  query result.
- **Writes**: none. Only a single `SELECT` (or `WITH … SELECT`) is accepted;
  the words that write, lock or act on the server (`INSERT`, `UPDATE`,
  `DELETE`, `INTO`, `FOR UPDATE`, `nextval`, `pg_read_file`, `LOAD_FILE`…) are
  refused, and so is a second statement. Every query then runs in a read-only
  transaction (the PostgreSQL session itself is read-only), rolled back, with
  a time limit on the server. The documentation asks for a database user who
  may only read: that is the real boundary, the guard and the transaction are
  belts and braces.
- **Network**: connections go only to the host and port of the configuration,
  one per read, closed right after. TLS is off, on without certificate check,
  or on with a full check, as chosen.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the third-party services and devices the integration talks to.
