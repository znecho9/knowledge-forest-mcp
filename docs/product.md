# Product brief

## Positioning

**Knowledge Forest is a personal learning-state engine for people who use AI to learn across projects.** It is not another note editor and it is not an autonomous tutor. It gives the user's chosen AI a durable, inspectable model of goals, prerequisites, learning depth, and demonstrated mastery.

The wedge is simple: connect it to an MCP host and ask the host to help with a real goal. The forest survives after the chat ends.

## Primary user

The first user is a technical learner, researcher, or builder who:

- uses more than one AI assistant;
- studies toward concrete projects rather than isolated trivia;
- wants prior learning to carry into later work;
- cares whether “understood” means more than reading a good explanation;
- is willing to keep private learning data local.

## Core jobs

1. **Turn a goal into a tractable path.** Decompose an observable outcome into a minimal sufficient, prerequisite-aware tree.
2. **Continue where I left off.** Recover the current node, selected depth, prior notes, and evidence in a new chat or model.
3. **Reuse real knowledge.** Link the same concept across projects only when its boundary and required evidence are equivalent.
4. **Tell learning from performance.** Keep source-visible work separate from new, unassisted, closed-book evidence.
5. **Own the record.** Inspect, back up, move, and version the complete forest without a proprietary account.

## Product principles

- **Goal first.** Knowledge exists in service of an observable outcome.
- **Diagnose before teaching.** Do not repeat what the learner can already transfer.
- **Minimum sufficient tree.** More nodes are not automatically better.
- **Explicit reuse.** Similarity can suggest a node; only deliberate equivalence merges one.
- **Evidence over prose.** Durable records, not an assistant's confidence, govern mastery.
- **Local first, cloud optional.** A user's private learning history must not be held hostage by sync.
- **Model neutral.** Reasoning lives in the host; Knowledge Forest owns state and invariants.

## Open-core boundary

| Apache-2.0 local core | Possible paid service |
|---|---|
| Unlimited local goals and nodes | Encrypted multi-device sync |
| Full MCP tool set | Hosted remote MCP endpoint |
| JSON import/export and backups | Managed version history and recovery |
| Evidence-gated verification | Team roles, policy, and audit console |
| One-machine concurrency safety | Multi-user realtime collaboration |
| Workbench-compatible data model | Premium institutional connectors |

The commercial layer must not remove local data access, cap local knowledge, weaken export, or force users to buy model tokens from Knowledge Forest.

## First-run experience

The desired activation sequence is:

1. Run `doctor` and see the resolved data file.
2. Add one MCP config block to the user's existing AI host.
3. Ask: “Help me learn enough to accomplish _X_.”
4. The host reads the overview, searches reusable nodes, and presents a compact proposed tree.
5. After confirmation, the host creates the tree and starts with the first ready node.
6. The learner returns later from a different chat and the host resumes from durable state.

Time to first useful tree should be under five minutes for someone who already has Node.js.

## Success measures

The public alpha should optimize for evidence of repeated use, not vanity traffic:

- successful MCP connection rate;
- share of new goals containing at least one deliberate reused node;
- share of learning sessions resumed in a later host conversation;
- percentage of `verified` nodes with accepted evidence records;
- zero unrecovered data-loss reports;
- median time from installation to first goal tree.

No product analytics are built into the local server. These measures should come from opt-in user research, issue templates, and aggregate hosted-service telemetry only when such a service exists.

## Non-goals for the alpha

- Replacing the user's notes app or reference manager.
- Generating a knowledge tree without an AI host.
- Automatically judging factual correctness with a hidden model.
- Social feeds, public profiles, streaks, or gamification.
- Silent concept merging.
- Remote HTTP transport before authentication and threat modeling are ready.

## Release path

### 0.1 — trustworthy local core

Local stdio MCP, goal trees, deterministic diagnostics, evidence rules, atomic backups, workbench compatibility, tests, and bilingual onboarding.

### 0.2 — migration and ergonomics

Dry-run import, schema migration command, richer resource views, install helpers, and a guided demo forest.

### 0.3 — learning continuity

Review scheduling, transfer checks, conflict-safe workbench synchronization, and clearer derived summaries whose sources remain traceable.

### 1.0 — stable contract

Versioned tool semantics, documented migration guarantees, recovery tooling, and compatibility fixtures for major MCP hosts.
