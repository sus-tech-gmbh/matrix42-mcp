# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it through
[GitHub's private vulnerability reporting](https://github.com/sus-tech-gmbh/matrix42-mcp/security/advisories/new),
which notifies the maintainers privately. If that is unavailable to you, contact
[S&S Technologies GmbH](https://sus-tech.com/en) and mention `matrix42-mcp` in the subject.

Please include what you can: affected version, configuration, a reproduction, and the impact you
believe it has. We will acknowledge your report, keep you updated while we work on it, and credit
you in the release notes unless you prefer otherwise.

This is a volunteer-maintained community project, so we cannot promise a fixed response time — but
security reports go to the front of the queue.

## Supported versions

The latest published release is the supported one. Fixes are released forward; there are no
long-term support branches.

## What this server is, in security terms

**It is a credentialed proxy.** Anything the configured Matrix42 account can reach through the API,
a connected assistant can reach through the tools it is given. The relevant boundary is the account
you configure, not the server.

Deploying it responsibly:

- **Scope the account.** Give it the permissions the assistant actually needs and no more. Do not
  point it at production with an administrator token because it was convenient.
- **Leave writes off.** Write tools are absent from the tool list unless `M42_ALLOW_WRITES=1`. Turn
  them on deliberately, for a specific reason.
- **Never disable TLS verification in production.** `M42_ALLOW_INSECURE_TLS=1` exists for
  self-signed development instances only.
- **Treat the token like a password.** Keep it out of shell history, version control and issue
  reports. A token that has been pasted publicly is compromised — rotate it.
- **Narrow the surface** with `M42_TOOLS` if you only need part of it.

## What we consider a vulnerability

- Credential leakage: a token or password reaching logs, tool output, or an assistant.
- A read-only deployment performing a write.
- A tool reaching data outside what the configured account is entitled to.
- Injection through a tool parameter that changes the shape of a request in an unintended way.

## What we do not consider a vulnerability

- An assistant reading data the configured account is legitimately entitled to read. That is the
  purpose of the software; scope the account instead.
- Writes performed by a deployment that enabled writes.
- Weaknesses in Matrix42 itself — please report those to Matrix42 AG, not here.
