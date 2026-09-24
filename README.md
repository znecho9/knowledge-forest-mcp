<p align="center">
  <img src="docs/assets/logo.svg" width="112" alt="Knowledge Forest logo">
</p>

<h1 align="center">Knowledge Forest MCP</h1>

<p align="center"><strong>A local-first learning-state engine for any AI tutor.</strong></p>

<p align="center">
  Turn goals into prerequisite-aware knowledge trees, preserve learning history, and require real evidence before claiming mastery.
</p>

<p align="center">
  <a href="README.zh-CN.md">中文</a> ·
  <a href="docs/product.md">Product principles</a> ·
  <a href="docs/architecture.md">Architecture</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

## Why it exists

AI tutors are excellent at explaining a topic and terrible at owning long-lived learning state. A chat can sound productive while forgetting prerequisites, duplicating concepts across projects, or treating a polished answer as mastery.

Knowledge Forest gives the model a durable learning layer:

- **Goal trees** connect an observable outcome to the minimum knowledge needed to reach it.
- **Canonical nodes** let one concept serve several goals without copying its learning history.
- **Evidence-gated mastery** distinguishes reading and assisted practice from novel, closed-book performance.
- **Local-first storage** keeps the learner's goals, notes, and evidence in a portable JSON file.
- **Model-neutral MCP** works with any compatible host. The host's model does the reasoning and pays its own token cost; this server does not call an LLM.

## Quick start

Requirements: Node.js 22 or newer.

Run directly from GitHub:

```bash
npx --yes github:znecho9/knowledge-forest-mcp doctor
npx --yes github:znecho9/knowledge-forest-mcp
```

Or develop locally:

```bash
git clone https://github.com/znecho9/knowledge-forest-mcp.git
cd knowledge-forest-mcp
npm ci
npm run check
npm run dev
```

The default data file is `~/.knowledge-forest/knowledge-forest.json`. Override it with `KNOWLEDGE_FOREST_FILE` or `--data-file`.

## Connect an MCP host

Use the exact data path you want the host to access.

### Codex

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.knowledge-forest]
command = "npx"
args = ["--yes", "github:znecho9/knowledge-forest-mcp"]
env = { KNOWLEDGE_FOREST_FILE = "/absolute/path/to/knowledge-forest.json" }
```

### Claude Desktop and JSON-configured hosts

```json
{
  "mcpServers": {
    "knowledge-forest": {
      "command": "npx",
      "args": ["--yes", "github:znecho9/knowledge-forest-mcp"],
      "env": {
        "KNOWLEDGE_FOREST_FILE": "/absolute/path/to/knowledge-forest.json"
      }
    }
  }
}
```

Generate both snippets with the resolved path:

```bash
npx --yes github:znecho9/knowledge-forest-mcp config --data-file /absolute/path/to/knowledge-forest.json
```

## What the model can do

| MCP capability | Purpose | Changes data? |
|---|---|---:|
| `forest_overview` | See goals, progress, and ready work | No |
| `search_knowledge` | Find reusable canonical nodes | No |
| `get_node_context` | Read relationships, notes, and evidence | No |
| `diagnose_node` | Identify prerequisite, depth, and evidence gaps | No |
| `get_learning_queue` | Find ready and blocked nodes | No |
| `create_goal_tree` | Persist a minimal sufficient knowledge tree | Yes |
| `update_node_learning_state` | Set depth or workflow state | Yes |
| `append_learning_note` | Append notes, sources, reflections, or exercises | Yes |
| `record_verification` | Record evidence and enforce the mastery rule | Yes |
| `export_forest` | Read the complete portable archive | No |

The included `plan_learning_goal` prompt guides a host through search, explicit reuse, and tree creation.

## Mastery is deliberately hard to fake

`record_verification` marks a node `verified` only when all four conditions are true:

```text
demonstrated
AND closed_book
AND NOT assisted
AND novel_prompt
```

Source-visible research, explanations, summaries, and hinted answers remain useful learning records, but never become mastery evidence. Other tools cannot set `verified` directly.

## Works with the Knowledge Forest workbench

The storage envelope and core goal/node fields are compatible with the local Knowledge Forest workbench's `learning/knowledge-forest.json` shape. Point the MCP server at that file to let an AI host and the workbench share one canonical forest:

```bash
KNOWLEDGE_FOREST_FILE=/path/to/workbench/learning/knowledge-forest.json \
  node dist/cli.js doctor
```

Before sharing a live workbench file, commit or back it up. The server performs atomic writes, cross-process locking, validation, and retains the latest 20 MCP snapshots under `learning/backups/`. MCP-only append records are also mirrored to an adjacent `knowledge-forest.mcp-records.json` sidecar so a workbench autosave that knows only the core schema cannot erase them; `export` merges everything into one portable archive.

## Local-first guarantees

- No model API key is needed.
- No network request is made by the server.
- No telemetry is collected.
- No delete tool is exposed in v1.
- Every mutation is schema-validated and written atomically.
- Concurrent local writers use a lock to avoid lost updates.
- The archive is readable JSON and can be exported with `knowledge-forest-mcp export`.

## Open-core boundary

Everything required for a single learner to build, inspect, verify, back up, and move a forest is Apache-2.0 open source. Possible paid services—none are required by this server—include encrypted multi-device sync, hosted remote MCP, managed backups, organization controls, and premium connectors. See [the product brief](docs/product.md) for the explicit boundary.

## Status

`0.1.0` is the first public alpha. The data schema is versioned, but tool contracts may still evolve before `1.0`. Back up real learning data and review release notes before upgrading.

## Security and contributions

Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md). Bug reports and focused pull requests are welcome; start with [CONTRIBUTING.md](CONTRIBUTING.md).

Apache-2.0 © Knowledge Forest contributors.
