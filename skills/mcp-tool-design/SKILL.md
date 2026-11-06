---
name: mcp-tool-design
description: Use when writing, reviewing or scoring MCP tool definitions (names, titles, descriptions, input schemas, annotations), when agents pick the wrong tool, or when preparing an MCP server for the MCP Registry or a directory such as Glama. Covers Python MCP SDK and Pydantic schema traps.
---

# MCP Tool Design

Agents choose a tool from the catalog alone. Write the catalog for that reader
and hold it with tests; a directory score is a check, not the goal.

## Descriptions

- Open with a verb and what the tool returns.
- Where tools overlap (search and details, list and browse), name the sibling
  to use instead.
- Give output-to-input chains concretely: which field of which tool's answer
  becomes which parameter. Check every chain against the input schema; a
  description that leads to an input the schema rejects is worse than none.
- State what the annotations cannot: remote state a call changes, what the
  server remembers, limits such as date windows or page sizes, and data the
  caller must not send.
- Keep descriptions short and budget the whole catalog in bytes, with a test.
  Without a project budget, start at 200 to 400 bytes per tool description
  and a catalog total of tool count times 400; tighten or loosen the numbers
  deliberately and record them next to the test.

## Parameters

- Describe every input property. Directories score coverage, and agents guess
  formats without it.
- Pydantic: a PEP 695 `type X = Annotated[..., Field(description=...)]` alias
  becomes a `$ref` and the description disappears where it is used. Use a
  plain assignment alias, or put the description in `WithJsonSchema`.
- A shared alias needs a description that is true at every use.

## Metadata

- Give each tool a `title` and deliberate annotations (`readOnlyHint`,
  `destructiveHint`, `idempotentHint`, `openWorldHint`).
- The server's `serverInfo` (name, version, title, website URL, icons) and
  `server.json` must agree; test that they do.

## Registry and directories

- Validate `server.json` in CI with a pinned, signature-verified
  `mcp-publisher`. Publishing and namespace proof (DNS TXT or GitHub) are
  owner steps.
- Registry versions are immutable: run every check before the first publish.
  A missing icon or description costs a version.
- Glama indexes the Registry and GitHub and scores tool definitions (TDQS) on
  Purpose, Usage, Behavior, Parameters, Conciseness and Completeness, per Glama
  release from the image it builds itself. Check its build spec in the admin
  pages; its inferred defaults can be wrong.

## Tests that hold the line

- Every tool has a title; every input property has a description.
- Each description of an overlapping tool names its sibling.
- The catalog stays within its byte budget.
- `serverInfo` equals `server.json`.

## Suggested repository layout

- The server module that registers the tools, with descriptions and schemas
  next to the handlers.
- An integration test that lists the catalog through the MCP client and
  asserts the rules above.
- `server.json` at the repository root, validated in CI.
- A tool contract document (for example `MCP_CONTRACT.md`) stating each
  tool's inputs, outputs, side effects and sibling tools.
- A distribution document (for example `DISTRIBUTION.md`) recording directory
  build specs, such as the Glama build settings, and the publish checklist.

When rewriting descriptions, review every output-to-input chain against the
schema before release; a rewrite that only improves the score can still point
agents at inputs the server rejects.
