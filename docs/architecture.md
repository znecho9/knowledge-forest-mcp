# Architecture

## Requirements and constraints

### Functional

- Store goal trees, canonical knowledge nodes, append-only learning records, and verification evidence.
- Expose a small MCP surface that works with multiple AI hosts.
- Reuse nodes across goals without silently merging merely related concepts.
- Compute prerequisite readiness and deterministic learning gaps without a model call.
- Share the core goal/node shape with the Knowledge Forest workbench.

### Non-functional

- Local by default, zero telemetry, and zero server-side LLM cost.
- Recoverable atomic writes with no partial JSON on process interruption.
- No lost updates from multiple local MCP processes.
- Useful errors at the tool boundary; malformed state must fail closed.
- A normal user should be able to inspect and move all data.

### Initial scale

The JSON implementation is designed for one learner, up to 500 goals, 20,000 canonical nodes, and 100,000 learning or verification records. It favors operational simplicity and portability over high write throughput.

## Component view

```text
┌───────────────────────────────────────────────────────────────┐
│ MCP host: Codex / Claude / another compatible AI             │
│ - understands the user                                       │
│ - reasons, teaches, evaluates                                 │
│ - pays its own model-token cost                               │
└────────────────────────────┬──────────────────────────────────┘
                             │ MCP over stdio
┌────────────────────────────▼──────────────────────────────────┐
│ Knowledge Forest MCP                                         │
│                                                               │
│  server.ts       schemas + tool annotations + instructions    │
│       │                                                       │
│  service.ts      domain workflows and mastery invariants      │
│       │                                                       │
│  store.ts        validation, lock, snapshots, atomic rename   │
└────────────────────────────┬──────────────────────────────────┘
                             │ local filesystem only
┌────────────────────────────▼──────────────────────────────────┐
│ knowledge-forest.json                                        │
│ knowledge-forest.mcp-records.json (workbench-safe mirror)    │
│ backups/mcp-before-*.json                                    │
└───────────────────────────────────────────────────────────────┘
```

The workbench can point at the same JSON file. It remains a separate presentation and interactive tutoring surface; the MCP core does not import UI code or assume a particular host.

## Data model

```text
Forest
├── Goal[]
│   ├── Branch[]
│   └── NodeRef[] ── prerequisites[] ──┐
├── KnowledgeNode[] ◀──────────────────┘
└── LearningRecords
    ├── Entry[]          note / source / reflection / exercise
    ├── Verification[]   prompt, response, conditions, outcome
    └── Event[]          append-only change trail
```

A `KnowledgeNode` is canonical across the forest. A `NodeRef` contains goal-specific meaning: branch, importance, recommended depth, prerequisites, and why the node matters for that goal.

This separation prevents a project from overwriting global learning history while still allowing different projects to use the same concept differently.

## Write path

```text
tool call
  → validate arguments (Zod / MCP SDK)
  → acquire cross-process file lock
  → read the latest on-disk revision
  → clone and apply one domain mutation
  → validate schema and graph invariants
  → snapshot the previous file
  → write a unique temporary file
  → atomic rename over the canonical file
  → release the lock
```

An in-process promise queue prevents races between calls handled by one server. An adjacent lock file protects against two server processes. A 30-second stale-lock rule recovers from a crashed writer. The latest 20 MCP snapshots are retained. Append-only MCP records are embedded in the portable archive and mirrored to a sidecar; if the existing workbench rewrites only the core forest shape, the next MCP read restores records from that sidecar.

## Mastery invariant

Only `record_verification` can transition a node to `verified`. Acceptance is computed by the service, not supplied by the caller:

```text
accepted = outcome == demonstrated
        && closedBook
        && !assisted
        && novelPrompt
```

The evaluation of `outcome` is made by the connected host and remains auditable because the exact prompt, response, rationale, and conditions are persisted. A later product can add rubric or reviewer metadata without weakening this base rule.

## Failure handling

- Invalid input returns an MCP tool error and does not write.
- Invalid existing JSON or broken graph references fail closed with the data path in the error.
- A process crash before rename leaves the canonical file untouched.
- A process crash after snapshot but before rename leaves a recoverable previous copy.
- A busy lock times out with an actionable error rather than overwriting concurrent work.
- No delete tool exists in the alpha, reducing irreversible agent mistakes.

## Security and privacy boundaries

- The server makes no outbound network calls.
- stdio is local and inherits the host user's filesystem authority.
- The configured data path is the authority boundary: a host connected to this server can read and append to that forest.
- Configuration should point to one explicit file, not a broad directory containing unrelated private data.
- Remote HTTP, OAuth, shared accounts, and untrusted multi-user inputs are intentionally out of scope.

## Trade-offs

### JSON instead of SQLite

JSON aligns with the existing workbench, Git review, portability, and early user trust. It has higher whole-file write cost and weaker query performance. Revisit storage when archives approach tens of megabytes or concurrent writes become common; preserve JSON import/export as the durable interchange format.

### Host model evaluates answers

Keeping evaluation in the host avoids model cost and vendor lock-in. Quality depends on the selected model and prompt. Persisting the complete evidence record makes that judgment inspectable and allows later re-evaluation.

### Explicit reuse instead of automatic deduplication

This creates an extra turn when two concepts look identical, but prevents irreversible corruption of learning history. Future versions may offer candidates and confidence scores; merging should remain an explicit act.

### stdio only

stdio gives the smallest secure local surface and broad desktop-host support. Remote MCP requires authentication, authorization, rate limits, tenancy isolation, and a separate threat model; it belongs to a later hosted layer.

## What to revisit as usage grows

- Split append-only records from the current-state snapshot when write amplification becomes material.
- Add a migration engine before changing schema version 1.
- Add checksums and a repair command for interrupted external edits.
- Add opt-in encrypted sync with conflict semantics based on events, not last-write-wins files.
- Formalize evaluator identity and rubric versions for high-stakes learning claims.
- Introduce resource subscriptions when workbench and MCP clients need live change notifications.
