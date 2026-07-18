# Contributing

## Before You Start

Read [SPEC.md](SPEC.md). Keep each change focused and preserve the distinction
between portable Agent Skills and harness-specific integrations.

Never contribute credentials, private domains, local paths, production logs,
customer data, network snapshots, or copied private prompts.

## Workflow

1. Add or update a skill, reference, or integration with its safety limits.
2. Update the relevant README content and [CHANGELOG.md](CHANGELOG.md).
3. Run:

```bash
pre-commit run --all-files
bash -n integrations/claude/hooks/*.sh
```

4. Test hooks with representative safe and confirmation-required payloads.
5. Describe the user impact, privacy implications, and validation in the pull
   request.

## Security Issues

Do not disclose possible vulnerabilities in a public issue. Follow
[SECURITY.md](SECURITY.md).
