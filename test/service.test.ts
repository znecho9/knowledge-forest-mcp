import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { ForestService } from "../src/service.js";
import { ForestStore } from "../src/store.js";
import type { CreateGoalTreeInput } from "../src/schema.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture(): Promise<{ directory: string; store: ForestStore; service: ForestService }> {
  const directory = await mkdtemp(join(tmpdir(), "knowledge-forest-mcp-"));
  temporaryDirectories.push(directory);
  const store = new ForestStore({ dataDir: directory });
  return { directory, store, service: new ForestService(store) };
}

function goalInput(): CreateGoalTreeInput {
  return {
    goal: {
      title: "Understand flight",
      description: "Build a physical mental model.",
      outcome: "Explain and predict lift changes in a novel scenario.",
      accent: "#3f7668",
    },
    branches: [{
      temp_id: "physics",
      title: "Physics",
      description: "The minimum mechanics foundation.",
      nodes: [
        {
          temp_id: "forces",
          title: "Forces and free-body diagrams",
          domain: "Mechanics",
          description: "Represent forces acting on a body.",
          tags: ["physics"],
          why: "Lift is a force.",
          importance: "required",
          recommended_depth: "master",
          prerequisites: [],
          reuse_node_id: null,
        },
        {
          temp_id: "lift",
          title: "Aerodynamic lift",
          domain: "Aerodynamics",
          description: "Connect pressure and momentum change to lift.",
          tags: ["flight"],
          why: "It is the target phenomenon.",
          importance: "required",
          recommended_depth: "master",
          prerequisites: ["forces"],
          reuse_node_id: null,
        },
      ],
    }],
  };
}

test("creates a prerequisite-aware tree and exposes a ready queue", async () => {
  const { store, service } = await fixture();
  const created = await service.createGoalTree(goalInput());
  const nodeIdMap = created.nodeIdMap as Record<string, string>;
  const queue = await service.learningQueue(created.goalId as string);
  const ready = queue.ready as Array<{ node: { id: string } }>;
  const blocked = queue.blocked as Array<{ node: { id: string }; unmetPrerequisiteIds: string[] }>;

  assert.equal(ready.length, 1);
  assert.equal(ready[0]?.node.id, nodeIdMap.forces);
  assert.equal(blocked[0]?.node.id, nodeIdMap.lift);
  assert.deepEqual(blocked[0]?.unmetPrerequisiteIds, [nodeIdMap.forces]);

  const onDisk = JSON.parse(await readFile(store.dataFile, "utf8")) as { format: string; forest: { goals: unknown[] } };
  assert.equal(onDisk.format, "knowledge-forest-backup");
  assert.equal(onDisk.forest.goals.length, 1);
});

test("source-visible notes never change mastery and only strict evidence verifies", async () => {
  const { service } = await fixture();
  const created = await service.createGoalTree(goalInput());
  const nodeId = (created.nodeIdMap as Record<string, string>).forces!;

  const note = await service.appendLearningNote({
    nodeId,
    kind: "source",
    content: "A textbook explanation of free-body diagrams.",
    sourceVisibility: "source-visible",
    sources: [{ title: "Open textbook", url: "https://example.com/book" }],
  });
  assert.equal(note.masteryChanged, false);
  assert.equal(note.nodeStatus, "unassessed");

  const assisted = await service.recordVerification({
    nodeId,
    prompt: "Draw a free-body diagram for a new case.",
    response: "I followed the hint and drew the forces.",
    outcome: "demonstrated",
    closedBook: true,
    assisted: true,
    novelPrompt: true,
    rationale: "Correct after a hint.",
  });
  assert.equal(assisted.accepted, false);
  assert.equal(assisted.nodeStatus, "learning");

  const independent = await service.recordVerification({
    nodeId,
    prompt: "A crate accelerates on a rough incline. Draw and explain every force.",
    response: "Weight acts downward, normal force is perpendicular, and friction opposes relative motion.",
    outcome: "demonstrated",
    closedBook: true,
    assisted: false,
    novelPrompt: true,
    rationale: "Correct force inventory and directions in a transfer case.",
  });
  assert.equal(independent.accepted, true);
  assert.equal(independent.nodeStatus, "verified");
});

test("requires explicit reuse instead of silently merging an equivalent concept", async () => {
  const { service } = await fixture();
  const first = await service.createGoalTree(goalInput());
  await assert.rejects(() => service.createGoalTree({
    ...goalInput(),
    goal: { ...goalInput().goal, title: "Design a glider" },
  }), /Retry with reuse_node_id/);

  const input = goalInput();
  input.goal.title = "Design a glider";
  input.branches[0]!.nodes[0]!.reuse_node_id = (first.nodeIdMap as Record<string, string>).forces!;
  input.branches[0]!.nodes[1]!.title = "Glider lift design";
  const second = await service.createGoalTree(input);
  assert.deepEqual(second.reusedNodeIds, [(first.nodeIdMap as Record<string, string>).forces]);
});

test("loads the existing workbench-compatible v1 forest shape", async () => {
  const { directory, store } = await fixture();
  const at = "2026-01-01T00:00:00.000Z";
  await writeFile(join(directory, "knowledge-forest.json"), JSON.stringify({
    format: "knowledge-forest-backup",
    version: 1,
    savedAt: at,
    reason: "workbench",
    forest: {
      schemaVersion: 1,
      goals: [{
        id: "goal-demo",
        title: "Demo",
        description: "",
        outcome: "Demonstrate compatibility.",
        createdAt: at,
        accent: "#3f7668",
        branches: [{ id: "basics", title: "Basics", description: "" }],
        nodeRefs: [{
          nodeId: "kn-demo",
          branchId: "basics",
          prerequisites: [],
          importance: "required",
          recommendedDepth: "overview",
          why: "Required.",
          reused: false,
        }],
      }],
      nodes: [{
        id: "kn-demo",
        title: "Demo node",
        domain: "Testing",
        description: "",
        tags: [],
        desiredDepth: "undecided",
        status: "unassessed",
        notes: "",
        evidence: [],
        createdAt: at,
      }],
    },
  }), "utf8");

  const forest = await store.load();
  assert.equal(forest.nodes[0]?.id, "kn-demo");
  assert.deepEqual(forest.learningRecords.entries, []);
  assert.equal(forest.updatedAt, at);
});

test("serializes concurrent writers across server processes", async () => {
  const { directory, service } = await fixture();
  const created = await service.createGoalTree(goalInput());
  const nodeId = (created.nodeIdMap as Record<string, string>).forces!;
  const secondService = new ForestService(new ForestStore({ dataDir: directory }));

  await Promise.all([
    service.appendLearningNote({
      nodeId,
      kind: "note",
      content: "First concurrent note.",
      sourceVisibility: "closed-book",
      sources: [],
    }),
    secondService.appendLearningNote({
      nodeId,
      kind: "reflection",
      content: "Second concurrent note.",
      sourceVisibility: "closed-book",
      sources: [],
    }),
  ]);

  const context = await service.getNodeContext(nodeId);
  assert.equal((context.learningEntries as unknown[]).length, 2);
});

test("keeps MCP records when the workbench rewrites only its canonical fields", async () => {
  const { store, service } = await fixture();
  const created = await service.createGoalTree(goalInput());
  const nodeId = (created.nodeIdMap as Record<string, string>).forces!;
  await service.appendLearningNote({
    nodeId,
    kind: "reflection",
    content: "This must survive a workbench autosave.",
    sourceVisibility: "closed-book",
    sources: [],
  });

  const saved = JSON.parse(await readFile(store.dataFile, "utf8")) as {
    forest: { schemaVersion: 1; goals: unknown[]; nodes: unknown[] };
  };
  await writeFile(store.dataFile, JSON.stringify({
    format: "knowledge-forest-backup",
    version: 1,
    savedAt: "2026-09-24T00:00:00.000Z",
    reason: "workbench-autosave",
    forest: {
      schemaVersion: saved.forest.schemaVersion,
      goals: saved.forest.goals,
      nodes: saved.forest.nodes,
    },
  }), "utf8");

  const reloaded = await new ForestService(new ForestStore({ dataFile: store.dataFile })).getNodeContext(nodeId);
  assert.equal((reloaded.learningEntries as Array<{ content: string }>)[0]?.content, "This must survive a workbench autosave.");
});
