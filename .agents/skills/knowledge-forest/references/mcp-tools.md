# Knowledge Forest MCP tool contract (alpha 0.1.1)

This file reflects `src/server.ts`, `src/schema.ts`, and `src/service.ts` in this repository. Use the **live tool schema** as the final authority if it differs from these notes. Hosts may namespace the tool names; match the suffix. All arguments use snake_case at the MCP boundary.

## Tool inventory

| Tool | Input fields | Effect |
| --- | --- | --- |
| `forest_overview` | `goal_id?` | Read goals, counts, data path, and ready actions. Start here. |
| `search_knowledge` | `query`, `limit?=20` (1–100) | Read lexical matches among existing canonical nodes. |
| `get_node_context` | `node_id` | Read memberships, prerequisites, notes, verifications, diagnosis. |
| `diagnose_node` | `node_id` | Read deterministic learning and verification gaps. |
| `get_learning_queue` | `goal_id?`, `limit?=20` (1–100) | Read ready/blocked nodes; does not change progress. |
| `create_goal_tree` | `goal`, `branches` | **Write:** add a goal and new/reused node references. Not idempotent. |
| `update_node_learning_state` | `node_id`, `desired_depth?`, `status?`, `reason` | **Write:** change depth or non-verified workflow status. |
| `append_learning_note` | `node_id`, `kind`, `content`, `source_visibility`, `sources?=[]` | **Write:** append a learning entry. Not idempotent. |
| `record_verification` | `node_id`, `prompt`, `response`, `outcome`, `closed_book`, `assisted`, `novel_prompt`, `rationale` | **Write:** append a real assessment and let the server decide acceptance. Not idempotent. |
| `export_forest` | `{}` | Read the **entire private forest** and configured file path; avoid by default. |

The host model decides pedagogy and factual evaluation. The MCP server validates storage contracts, graph invariants, and the *boolean* acceptance rule. It does not fact-check sources or judge whether a response is scientifically correct.

## Create a goal tree

Present the proposed goal, minimal branches, dependencies, and reuse choices to the user; obtain approval before the write.

```json
{
  "goal": {
    "title": "Explain a new dynamic loading case",
    "description": "Understand the minimum concepts needed for a new example.",
    "outcome": "Independently derive and explain a response for an unfamiliar loading history."
  },
  "branches": [
    {
      "temp_id": "fundamentals",
      "title": "Foundations",
      "description": "Only the required prerequisites.",
      "nodes": [
        {
          "temp_id": "convolution",
          "title": "Impulse response and convolution",
          "domain": "Structural dynamics",
          "description": "Relate an input history to a linear system response.",
          "tags": ["dynamics", "convolution"],
          "why": "Required to derive the response under a new loading history.",
          "importance": "required",
          "recommended_depth": "master",
          "prerequisites": [],
          "reuse_node_id": null
        }
      ]
    }
  ]
}
```

Notes:
- `goal.title`, `goal.outcome` and branch/node identifiers are required. Provide non-empty text for meaningful descriptions and rationales.
- At least one branch with at least one node is required; a branch's `nodes` array is not optional.
- Each node's `temp_id` must be unique within the request. A `prerequisites` entry names another **request-local `temp_id`**, not an existing canonical node ID.
- The prerequisite graph must be acyclic; no self-dependencies or unknown IDs.
- `reuse_node_id` points to an existing canonical node **after explicit equivalence review**; it must not be used twice in the same goal. Use `null` when creating a new concept.
- `importance`: `required` / `conditional` / `optional`; `recommended_depth`: `overview` / `master` / `deep`. This recommendation does not overwrite the learner's `desired_depth`.
- An identical normalized domain and title is rejected unless reuse is specified. `search_knowledge` is lexical; search likely variants before assuming no match.
- Successful output includes `goalId`, `createdNodeIds`, `reusedNodeIds`, `nodeIdMap`. Save returned IDs; do not fabricate them.

## Update state

For `update_node_learning_state`:
- `desired_depth`: `undecided`, `skip`, `overview`, `master`, or `deep` (optional).
- `status`: `unassessed`, `queued`, `learning`, `verifying`, or `parked` (optional; **not** `verified`).
- Supply at least one of `desired_depth` or `status`, plus a non-empty `reason`. A learner's choice and current context should ground changes. Avoid changing an already verified node's status by accident.

For `append_learning_note`:
- `kind`: `note`, `reflection`, `source`, or `exercise`.
- `source_visibility`: `source-visible` or `closed-book`. A source-assisted research result belongs in `source-visible` even if the agent later summarizes it from memory.
- `sources`: array of objects `{ "title": "...", "url": "https://..." }`; `url` is optional but, if present, must be a valid URL. Do not invent source metadata.
- A note never changes mastery (`masteryChanged: false`).

## Record mastery evidence

For `record_verification`:
- `outcome`: `not-demonstrated`, `partial`, or `demonstrated`.
- `closed_book`, `assisted`, `novel_prompt`: booleans based on the **actual conditions** of the learner's attempt.
- `prompt`: the actual unseen task; `response`: the learner's actual answer; `rationale`: assessment of that answer.
- Acceptance is computed by the server as `demonstrated && closed_book && !assisted && novel_prompt`.
- Inspect returned `accepted` and `nodeStatus`. A successful tool call can have `accepted: false`; do not equate tool success with verified mastery.
- A reading summary, model-written answer, hinted exercise, or declared confidence cannot establish mastery. If the conditions were not observed, do not claim independent verification.

## Operational errors

- Tool errors return `isError: true` and text content. Unsupported or invalid arguments, unknown goal/node IDs, invalid JSON, and lock contention should not be silently corrected by inventing IDs or overwriting the archive.
- After a timeout on a non-idempotent write, first read state (`forest_overview` and relevant `get_node_context` or `get_learning_queue`) to check if it committed. Only then decide whether a retry is appropriate.
- A newly connected host may point to a different `KNOWLEDGE_FOREST_FILE` than the user expects. Show the resolved path from `forest_overview` before any write to an ambiguous forest.
- `export_forest` includes all goals, learning notes, and verification responses, not merely a progress summary. Do not invoke it or share its output without a specific user request.
