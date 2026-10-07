# Contributing

## Before You Start

Read [SPEC.md](SPEC.md). Keep each change focused and preserve the distinction
between portable Agent Skills and platform-specific integrations.

Never contribute credentials, private domains, local paths, production logs,
customer data, network snapshots, or copied private prompts.

## Workflow

1. Add or update a skill, reference, or integration with its safety limits.
2. Update the relevant README content and [CHANGELOG.md](CHANGELOG.md).
3. Run:

```bash
pre-commit run --all-files
while IFS= read -r -d '' file; do bash -n "$file"; done < <(git ls-files -z '*.sh')
node --test tests/*.test.mjs integrations/opendeck/dev.krzysztof.agents.sdPlugin/test/*.test.js
bash skills/council/scripts/council_test.sh
```

4. Use Node.js 24 or newer for these checks. Test changed runtime paths with
   representative inputs; council tests use fixture CLIs without model calls.
5. Describe the user impact, privacy implications, and validation in the pull
   request.

## Security Issues

Do not disclose possible vulnerabilities in a public issue. Follow
[SECURITY.md](SECURITY.md).
