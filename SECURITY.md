# Security Policy

## Supported Version

Security fixes are applied to the default branch.

## Reporting A Vulnerability

Do not open public issues containing credentials, network topology, customer
data, telemetry payloads, or unredacted logs. Report a suspected secret or
security issue privately through GitHub's security advisory flow or directly to
the repository owner.

Include affected files, the relevant commit or branch, reproduction steps, and
impact. Do not include real secrets or production data.

## Scope

Credential exposure, unsafe hook behavior, command-injection paths, private
data disclosure, and unsafe default instructions are in scope.

This repository provides guidance, not a security boundary. Review every skill,
hook, and command against your environment before enabling it.
