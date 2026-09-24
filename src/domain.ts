import { randomUUID } from "node:crypto";
import type { Forest, Goal, KnowledgeNode, LearningEvent } from "./schema.js";

const accents = ["#c76d3a", "#3f7668", "#6b66a3", "#a8873a", "#39718c", "#9a5868"];

export function nowIso(): string {
  return new Date().toISOString();
}

export function emptyForest(at = nowIso()): Forest {
  return {
    schemaVersion: 1,
    revision: 0,
    createdAt: at,
    updatedAt: at,
    goals: [],
    nodes: [],
    learningRecords: {
      entries: [],
      verifications: [],
      events: [{
        id: eventId(),
        type: "forest-initialized",
        summary: "Initialized a local Knowledge Forest.",
        createdAt: at,
      }],
    },
  };
}

export function eventId(): string {
  return `evt-${randomUUID()}`;
}

export function recordId(prefix: "note" | "verify"): string {
  return `${prefix}-${randomUUID()}`;
}

export function slug(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 52) || "knowledge";
}

export function uniqueId(prefix: "goal" | "kn" | "branch", label: string, used: Set<string>): string {
  const base = `${prefix}-${slug(label)}`;
  let candidate = base;
  let counter = 2;
  while (used.has(candidate)) candidate = `${base}-${counter++}`;
  used.add(candidate);
  return candidate;
}

export function nextAccent(forest: Forest): string {
  return accents[forest.goals.length % accents.length] ?? accents[0]!;
}

export function normalizedConcept(node: Pick<KnowledgeNode, "title" | "domain">): string {
  return `${node.domain.trim().toLocaleLowerCase()}::${node.title.trim().toLocaleLowerCase()}`;
}

export function assertForestIntegrity(forest: Forest): void {
  const nodeIds = new Set<string>();
  for (const node of forest.nodes) {
    if (nodeIds.has(node.id)) throw new Error(`Duplicate knowledge node ID: ${node.id}`);
    nodeIds.add(node.id);
  }

  const goalIds = new Set<string>();
  for (const goal of forest.goals) {
    if (goalIds.has(goal.id)) throw new Error(`Duplicate goal ID: ${goal.id}`);
    goalIds.add(goal.id);
    assertGoalIntegrity(goal, nodeIds);
  }

  for (const entry of forest.learningRecords.entries) {
    if (!nodeIds.has(entry.nodeId)) throw new Error(`Learning entry ${entry.id} references missing node ${entry.nodeId}.`);
  }
  for (const evidence of forest.learningRecords.verifications) {
    if (!nodeIds.has(evidence.nodeId)) throw new Error(`Verification ${evidence.id} references missing node ${evidence.nodeId}.`);
  }
}

function assertGoalIntegrity(goal: Goal, nodeIds: Set<string>): void {
  const branchIds = new Set<string>();
  for (const branch of goal.branches) {
    if (branchIds.has(branch.id)) throw new Error(`Goal ${goal.id} contains duplicate branch ID ${branch.id}.`);
    branchIds.add(branch.id);
  }

  const memberIds = new Set(goal.nodeRefs.map((ref) => ref.nodeId));
  if (memberIds.size !== goal.nodeRefs.length) throw new Error(`Goal ${goal.id} contains duplicate node references.`);
  const graph = new Map<string, string[]>();
  for (const ref of goal.nodeRefs) {
    if (!nodeIds.has(ref.nodeId)) throw new Error(`Goal ${goal.id} references missing node ${ref.nodeId}.`);
    if (!branchIds.has(ref.branchId)) throw new Error(`Goal ${goal.id} references missing branch ${ref.branchId}.`);
    for (const prerequisite of ref.prerequisites) {
      if (prerequisite === ref.nodeId) throw new Error(`Node ${ref.nodeId} cannot depend on itself.`);
      if (!memberIds.has(prerequisite)) throw new Error(`Prerequisite ${prerequisite} is not part of goal ${goal.id}.`);
    }
    graph.set(ref.nodeId, ref.prerequisites);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) throw new Error(`Goal ${goal.id} contains a prerequisite cycle at ${nodeId}.`);
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const prerequisite of graph.get(nodeId) ?? []) visit(prerequisite);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const nodeId of graph.keys()) visit(nodeId);
}

export function addEvent(
  forest: Forest,
  event: Pick<LearningEvent, "type" | "summary"> & { goalId?: string; nodeId?: string },
  at = nowIso(),
): void {
  forest.learningRecords.events.push({
    id: eventId(),
    type: event.type,
    summary: event.summary,
    ...(event.goalId ? { goalId: event.goalId } : {}),
    ...(event.nodeId ? { nodeId: event.nodeId } : {}),
    createdAt: at,
  });
}

export function nodeMap(forest: Forest): Map<string, KnowledgeNode> {
  return new Map(forest.nodes.map((node) => [node.id, node]));
}
