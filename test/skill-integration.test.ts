import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

test("internal skill workflow executes against an isolated live MCP server", async () => {
  const directory = await mkdtemp(join(tmpdir(), "knowledge-forest-skill-e2e-"));
  const dataFile = join(directory, "isolated-forest.json");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/cli.ts", "serve", "--data-file", dataFile],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const client = new Client({ name: "knowledge-forest-skill-e2e", version: "0.1.0" });

  try {
    await client.connect(transport);

    const overview = await client.callTool({ name: "forest_overview", arguments: {} });
    assert.equal(overview.isError, undefined);
    assert.equal((overview.structuredContent as { counts: { goals: number } }).counts.goals, 0);

    const search = await client.callTool({
      name: "search_knowledge",
      arguments: { query: "Transfer dynamics" },
    });
    assert.equal(search.isError, undefined);
    assert.equal((search.structuredContent as { count: number }).count, 0);

    // Represents a goal already proposed to and approved by a synthetic test learner.
    const created = await client.callTool({
      name: "create_goal_tree",
      arguments: {
        goal: {
          title: "Transfer dynamics test",
          description: "An isolated synthetic learning goal.",
          outcome: "Explain a new input history without assistance.",
        },
        branches: [{
          temp_id: "basis",
          title: "Basis",
          description: "Minimum foundation.",
          nodes: [{
            temp_id: "impulse",
            title: "Impulse response",
            domain: "Structural dynamics",
            description: "Explain the response to a short pulse.",
            tags: ["dynamics"],
            why: "Necessary for analyzing new loading histories.",
            importance: "required",
            recommended_depth: "master",
            prerequisites: [],
            reuse_node_id: null,
          }],
        }],
      },
    });
    assert.equal(created.isError, undefined);
    const result = created.structuredContent as {
      goalId: string;
      nodeIdMap: Record<string, string>;
    };
    assert.ok(result.goalId);
    assert.ok(result.nodeIdMap.impulse);
    const nodeId = result.nodeIdMap.impulse!;

    const queue = await client.callTool({
      name: "get_learning_queue",
      arguments: { goal_id: result.goalId },
    });
    assert.equal(queue.isError, undefined);
    const ready = (queue.structuredContent as {
      ready: Array<{ node: { id: string } }>;
    }).ready;
    assert.equal(ready[0]?.node.id, nodeId);

    const note = await client.callTool({
      name: "append_learning_note",
      arguments: {
        node_id: nodeId,
        kind: "source",
        content: "Synthetic source-visible derivation used only in a test.",
        source_visibility: "source-visible",
        sources: [{ title: "Synthetic exercise sheet" }],
      },
    });
    assert.equal(note.isError, undefined);
    assert.equal((note.structuredContent as { masteryChanged: boolean }).masteryChanged, false);

    const verification = await client.callTool({
      name: "record_verification",
      arguments: {
        node_id: nodeId,
        prompt: "Explain an unfamiliar short-pulse response.",
        response: "I worked it out after receiving a hint.",
        outcome: "demonstrated",
        closed_book: true,
        assisted: true,
        novel_prompt: true,
        rationale: "The attempt used hints, so it is not unassisted mastery.",
      },
    });
    assert.equal(verification.isError, undefined);
    const verdict = verification.structuredContent as {
      accepted: boolean;
      nodeStatus: string;
    };
    assert.equal(verdict.accepted, false);
    assert.notEqual(verdict.nodeStatus, "verified");

    const context = await client.callTool({
      name: "get_node_context",
      arguments: { node_id: nodeId },
    });
    assert.equal(context.isError, undefined);
    const saved = context.structuredContent as {
      learningEntries: Array<{ sourceVisibility: string }>;
      verifications: Array<{ accepted: boolean; assisted: boolean }>;
    };
    assert.equal(saved.learningEntries.length, 1);
    assert.equal(saved.learningEntries[0]?.sourceVisibility, "source-visible");
    assert.equal(saved.verifications[0]?.assisted, true);
    assert.equal(saved.verifications[0]?.accepted, false);
  } finally {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
