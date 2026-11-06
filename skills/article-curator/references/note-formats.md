# Note Formats

Use these formats unless `note_template` points to a template file. A custom
template may use the placeholders `{{title}}`, `{{source}}`, `{{created}}`,
`{{tags}}`, `{{type}}`, `{{summary}}` and `{{body}}`; fill the body with the
section structure of the matching transformation below.

Write in the configured `language`. Keep notes short: the goal is something
the user will reuse, not a second copy of the article.

## Frontmatter

```yaml
---
title: <concise title>
type: knowledge | process | protocol
source: <original URL>
created: <YYYY-MM-DD>
tags: [<per tags settings>]
---
```

Omit `tags` when `tags.mode` is `none`. Keep any frontmatter keys the
template adds.

## Transformations

Technical knowledge (`type: knowledge`):

- Mechanism - how it works, in a few sentences
- When to use it, and when not to
- Constraints and trade-offs
- How to verify it works
- Implications for the user's work, if `context_files` show any

Process or checklist (`type: process`):

- Outcome - what done looks like
- Prerequisites
- Steps - numbered, each one actionable
- Definition of done

Life advice or protocol (`type: protocol`):

- Trigger - when to apply it
- Steps
- Cadence
- Stop conditions - when to stop or reconsider
- Evidence - how strong the source's support is

Personal memory candidate: one or two sentences stating a durable preference,
decision or lesson, with the date and source URL, appended to `memory_file`.

## Review draft

```yaml
---
status: review
source: <original URL>
source_file: <path of the moved article>
destination: <target folder or existing note to update>
type: knowledge | process | protocol
---
```

Followed by the transformed content in the final note's format. When the
proposal updates an existing note, show the section to add or change, not the
whole note.

## Summary in the source article

After the frontmatter (or as a `summary` property in it):

```markdown
> Curator summary (<YYYY-MM-DD>): <2-3 sentences>. Relevance: <direct hit or worth reading>.
```
