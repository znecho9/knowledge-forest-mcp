# Contributing

Thanks for helping make durable AI-assisted learning more trustworthy.

## Before opening a change

- Use an issue for a new tool, schema change, or open-core boundary change.
- Keep the local core model-neutral and usable without a paid service.
- Do not add telemetry, model API calls, destructive tools, or silent node merging.
- Preserve compatibility with the documented `knowledge-forest.json` goal/node shape.

## Development

```bash
npm ci
npm run check
```

`npm run check` performs strict TypeScript validation, unit and protocol integration tests, a production build, and a package dry run.

For an interactive MCP inspection:

```bash
npm run build
npx @modelcontextprotocol/inspector node dist/cli.js --data-dir ./examples/data
```

## Pull requests

A focused pull request should include:

- the user problem and chosen behavior;
- tests for domain invariants and failure cases;
- documentation for any tool, storage, or setup change;
- migration notes when persisted data changes;
- no generated `dist/`, local data, credentials, or dependency directories.

By submitting a contribution, you agree that it is licensed under Apache-2.0.
