import { addEvent, nextAccent, nodeMap, normalizedConcept, nowIso, recordId, uniqueId } from "./domain.js";
import {
  createGoalTreeInputSchema,
  type CreateGoalTreeInput,
  type Depth,
  type Forest,
  type Goal,
  type Importance,
  type KnowledgeNode,
  type Status,
} from "./schema.js";
import { ForestStore } from "./store.js";

type NodeMembership = {
  goalId: string;
  goalTitle: string;
  branchId: string;
  branchTitle: string;
  prerequisites: string[];
  importance: Importance;
  recommendedDepth: "overview" | "master" | "deep";
  why: string;
  reused: boolean;
};

export class ForestService {
  constructor(readonly store: ForestStore) {}

  async overview(goalId?: string): Promise<Record<string, unknown>> {
    const forest = await this.store.load();
    const goals = goalId ? forest.goals.filter((goal) => goal.id === goalId) : forest.goals;
    if (goalId && goals.length === 0) throw new Error(`Unknown goal: ${goalId}`);
    const includedNodeIds = new Set(goals.flatMap((goal) => goal.nodeRefs.map((ref) => ref.nodeId)));
    const nodes = goalId ? forest.nodes.filter((node) => includedNodeIds.has(node.id)) : forest.nodes;
    const byStatus = Object.fromEntries(
      ["unassessed", "queued", "learning", "verifying", "verified", "parked"].map((status) => [
        status,
        nodes.filter((node) => node.status === status).length,
      ]),
    );
    const queue = this.computeQueue(forest, goalId, 8);
    return {
      schemaVersion: forest.schemaVersion,
      revision: forest.revision,
      updatedAt: forest.updatedAt,
      dataFile: this.store.dataFile,
      recordsFile: this.store.recordsFile,
      counts: {
        goals: goals.length,
        nodes: nodes.length,
        verified: byStatus.verified,
        notes: forest.learningRecords.entries.filter((entry) => !goalId || includedNodeIds.has(entry.nodeId)).length,
        verifications: forest.learningRecords.verifications.filter((entry) => !goalId || includedNodeIds.has(entry.nodeId)).length,
      },
      byStatus,
      goals: goals.map((goal) => ({
        id: goal.id,
        title: goal.title,
        outcome: goal.outcome,
        nodeCount: goal.nodeRefs.length,
        verifiedCount: goal.nodeRefs.filter((ref) => nodeMap(forest).get(ref.nodeId)?.status === "verified").length,
      })),
      nextActions: queue.ready,
    };
  }

  async search(query: string, limit = 20): Promise<Record<string, unknown>> {
    const forest = await this.store.load();
    const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const results = forest.nodes
      .map((node) => ({ node, score: searchScore(node, terms), memberships: this.memberships(forest, node.id) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.node.title.localeCompare(b.node.title))
      .slice(0, Math.min(Math.max(limit, 1), 100))
      .map(({ node, score, memberships }) => ({
        id: node.id,
        title: node.title,
        domain: node.domain,
        description: node.description,
        tags: node.tags,
        desiredDepth: node.desiredDepth,
        status: node.status,
        score,
        usedBy: memberships.map((membership) => ({ goalId: membership.goalId, goalTitle: membership.goalTitle })),
      }));
    return { query, count: results.length, results };
  }

  async getNodeContext(nodeId: string): Promise<Record<string, unknown>> {
    const forest = await this.store.load();
    const node = requiredNode(forest, nodeId);
    const memberships = this.memberships(forest, nodeId);
    const nodes = nodeMap(forest);
    const prerequisiteIds = new Set(memberships.flatMap((membership) => membership.prerequisites));
    const dependentIds = new Set<string>();
    for (const goal of forest.goals) {
      for (const ref of goal.nodeRefs) if (ref.prerequisites.includes(nodeId)) dependentIds.add(ref.nodeId);
    }
    return {
      node,
      memberships,
      prerequisites: [...prerequisiteIds].map((id) => summarizeNode(nodes.get(id))).filter(Boolean),
      dependents: [...dependentIds].map((id) => summarizeNode(nodes.get(id))).filter(Boolean),
      learningEntries: forest.learningRecords.entries.filter((entry) => entry.nodeId === nodeId),
      verifications: forest.learningRecords.verifications.filter((entry) => entry.nodeId === nodeId),
      diagnosis: this.diagnose(forest, nodeId),
    };
  }

  async createGoalTree(input: CreateGoalTreeInput): Promise<Record<string, unknown>> {
    const parsed = createGoalTreeInputSchema.parse(input);
    return (await this.store.update("create-goal-tree", (forest) => {
      const at = nowIso();
      const usedGoalIds = new Set(forest.goals.map((goal) => goal.id));
      const usedNodeIds = new Set(forest.nodes.map((node) => node.id));
      const existingNodes = nodeMap(forest);
      const existingConcepts = new Map(forest.nodes.map((node) => [normalizedConcept(node), node]));
      const flatNodes = parsed.branches.flatMap((branch) => branch.nodes.map((node) => ({ branch, node })));
      const tempIds = flatNodes.map(({ node }) => node.temp_id);
      if (new Set(tempIds).size !== tempIds.length) throw new Error("Every node temp_id must be unique within the request.");
      const tempIdSet = new Set(tempIds);
      for (const { node } of flatNodes) {
        for (const prerequisite of node.prerequisites) {
          if (!tempIdSet.has(prerequisite)) throw new Error(`Node ${node.temp_id} references unknown prerequisite ${prerequisite}.`);
          if (prerequisite === node.temp_id) throw new Error(`Node ${node.temp_id} cannot depend on itself.`);
        }
      }

      const tempToCanonical = new Map<string, string>();
      const reused = new Set<string>();
      const requestConcepts = new Set<string>();
      for (const { node } of flatNodes) {
        if (node.reuse_node_id) {
          if (!existingNodes.has(node.reuse_node_id)) throw new Error(`Cannot reuse missing node ${node.reuse_node_id}.`);
          if (reused.has(node.reuse_node_id)) throw new Error(`Existing node ${node.reuse_node_id} is reused more than once in this goal.`);
          reused.add(node.reuse_node_id);
          tempToCanonical.set(node.temp_id, node.reuse_node_id);
          continue;
        }
        const concept = normalizedConcept(node);
        const existing = existingConcepts.get(concept);
        if (existing) {
          throw new Error(`A concept with the same domain and title already exists as ${existing.id}. Retry with reuse_node_id after confirming equivalence.`);
        }
        if (requestConcepts.has(concept)) throw new Error(`The request contains the same concept twice: ${node.domain} / ${node.title}.`);
        requestConcepts.add(concept);
        tempToCanonical.set(node.temp_id, uniqueId("kn", node.title, usedNodeIds));
      }

      const createdNodes: KnowledgeNode[] = [];
      for (const { node } of flatNodes) {
        if (node.reuse_node_id) continue;
        createdNodes.push({
          id: tempToCanonical.get(node.temp_id)!,
          title: node.title,
          domain: node.domain,
          description: node.description,
          tags: [...new Set(node.tags)],
          desiredDepth: "undecided",
          status: "unassessed",
          notes: "",
          evidence: [],
          createdAt: at,
          updatedAt: at,
        });
      }

      const goalId = uniqueId("goal", parsed.goal.title, usedGoalIds);
      const usedBranchIds = new Set<string>();
      const branchMap = new Map(parsed.branches.map((branch) => [
        branch.temp_id,
        uniqueId("branch", branch.title, usedBranchIds),
      ]));
      const goal: Goal = {
        id: goalId,
        title: parsed.goal.title,
        description: parsed.goal.description,
        outcome: parsed.goal.outcome,
        accent: parsed.goal.accent ?? nextAccent(forest),
        createdAt: at,
        updatedAt: at,
        branches: parsed.branches.map((branch) => ({
          id: branchMap.get(branch.temp_id)!,
          title: branch.title,
          description: branch.description,
        })),
        nodeRefs: flatNodes.map(({ branch, node }) => ({
          nodeId: tempToCanonical.get(node.temp_id)!,
          branchId: branchMap.get(branch.temp_id)!,
          prerequisites: node.prerequisites.map((id) => tempToCanonical.get(id)!),
          importance: node.importance,
          recommendedDepth: node.recommended_depth,
          why: node.why,
          reused: Boolean(node.reuse_node_id),
        })),
      };
      forest.nodes.push(...createdNodes);
      forest.goals.push(goal);
      addEvent(forest, {
        type: "goal-created",
        goalId,
        summary: `Created goal “${goal.title}” with ${goal.nodeRefs.length} knowledge nodes.`,
      }, at);
      return {
        goalId,
        createdNodeIds: createdNodes.map((node) => node.id),
        reusedNodeIds: [...reused],
        nodeIdMap: Object.fromEntries(tempToCanonical),
      };
    })).result;
  }

  async updateNodeState(input: {
    nodeId: string;
    desiredDepth?: Depth;
    status?: Exclude<Status, "verified">;
    reason: string;
  }): Promise<Record<string, unknown>> {
    if (input.desiredDepth === undefined && input.status === undefined) throw new Error("Provide desiredDepth or status.");
    return (await this.store.update("update-node-learning-state", (forest) => {
      const node = requiredNode(forest, input.nodeId);
      const before = { desiredDepth: node.desiredDepth, status: node.status };
      if (input.desiredDepth !== undefined) node.desiredDepth = input.desiredDepth;
      if (input.status !== undefined) node.status = input.status;
      node.updatedAt = nowIso();
      addEvent(forest, {
        type: "node-state-changed",
        nodeId: node.id,
        summary: `${input.reason} (${before.status}/${before.desiredDepth} → ${node.status}/${node.desiredDepth})`,
      }, node.updatedAt);
      return { node, before };
    })).result;
  }

  async appendLearningNote(input: {
    nodeId: string;
    kind: "note" | "reflection" | "source" | "exercise";
    content: string;
    sourceVisibility: "closed-book" | "source-visible";
    sources: Array<{ title: string; url?: string }>;
  }): Promise<Record<string, unknown>> {
    return (await this.store.update("append-learning-note", (forest) => {
      const node = requiredNode(forest, input.nodeId);
      const at = nowIso();
      const entry = {
        id: recordId("note"),
        nodeId: node.id,
        kind: input.kind,
        content: input.content,
        sourceVisibility: input.sourceVisibility,
        sources: input.sources,
        createdAt: at,
      };
      forest.learningRecords.entries.push(entry);
      node.updatedAt = at;
      addEvent(forest, {
        type: "learning-note-appended",
        nodeId: node.id,
        summary: `Appended a ${entry.kind} entry (${entry.sourceVisibility}).`,
      }, at);
      return { entry, nodeStatus: node.status, masteryChanged: false };
    })).result;
  }

  async recordVerification(input: {
    nodeId: string;
    prompt: string;
    response: string;
    outcome: "not-demonstrated" | "partial" | "demonstrated";
    closedBook: boolean;
    assisted: boolean;
    novelPrompt: boolean;
    rationale: string;
  }): Promise<Record<string, unknown>> {
    return (await this.store.update("record-verification", (forest) => {
      const node = requiredNode(forest, input.nodeId);
      const at = nowIso();
      const accepted = input.outcome === "demonstrated" && input.closedBook && !input.assisted && input.novelPrompt;
      const evidence = {
        id: recordId("verify"),
        nodeId: node.id,
        prompt: input.prompt,
        response: input.response,
        outcome: input.outcome,
        closedBook: input.closedBook,
        assisted: input.assisted,
        novelPrompt: input.novelPrompt,
        accepted,
        rationale: input.rationale,
        createdAt: at,
      };
      forest.learningRecords.verifications.push(evidence);
      const priorStatus = node.status;
      if (accepted) {
        node.status = "verified";
        if (!node.evidence.includes(evidence.id)) node.evidence.push(evidence.id);
      } else if (node.status !== "verified" && node.status !== "parked") {
        node.status = "learning";
      }
      node.updatedAt = at;
      addEvent(forest, {
        type: "verification-recorded",
        nodeId: node.id,
        summary: accepted
          ? `Accepted closed-book verification and marked “${node.title}” verified.`
          : `Recorded ${input.outcome} evidence; mastery did not advance.`,
      }, at);
      return {
        evidence,
        priorStatus,
        nodeStatus: node.status,
        accepted,
        acceptanceRule: "demonstrated AND closed_book AND NOT assisted AND novel_prompt",
      };
    })).result;
  }

  async learningQueue(goalId?: string, limit = 20): Promise<Record<string, unknown>> {
    const forest = await this.store.load();
    if (goalId && !forest.goals.some((goal) => goal.id === goalId)) throw new Error(`Unknown goal: ${goalId}`);
    return this.computeQueue(forest, goalId, Math.min(Math.max(limit, 1), 100));
  }

  async diagnoseNode(nodeId: string): Promise<Record<string, unknown>> {
    const forest = await this.store.load();
    return this.diagnose(forest, nodeId);
  }

  private memberships(forest: Forest, nodeId: string): NodeMembership[] {
    return forest.goals.flatMap((goal) => {
      const ref = goal.nodeRefs.find((candidate) => candidate.nodeId === nodeId);
      if (!ref) return [];
      const branch = goal.branches.find((candidate) => candidate.id === ref.branchId);
      return [{
        goalId: goal.id,
        goalTitle: goal.title,
        branchId: ref.branchId,
        branchTitle: branch?.title ?? ref.branchId,
        prerequisites: ref.prerequisites,
        importance: ref.importance,
        recommendedDepth: ref.recommendedDepth,
        why: ref.why,
        reused: ref.reused,
      }];
    });
  }

  private diagnose(forest: Forest, nodeId: string): Record<string, unknown> {
    const node = requiredNode(forest, nodeId);
    const nodes = nodeMap(forest);
    const memberships = this.memberships(forest, nodeId);
    const prerequisiteIds = [...new Set(memberships.flatMap((membership) => membership.prerequisites))];
    const unmetPrerequisites = prerequisiteIds
      .map((id) => nodes.get(id))
      .filter((candidate): candidate is KnowledgeNode => Boolean(candidate) && candidate?.status !== "verified")
      .map((candidate) => summarizeNode(candidate));
    const verifications = forest.learningRecords.verifications.filter((item) => item.nodeId === nodeId);
    const acceptedEvidence = verifications.filter((item) => item.accepted);
    const gaps: string[] = [];
    if (unmetPrerequisites.length) gaps.push(`${unmetPrerequisites.length} prerequisite(s) are not verified.`);
    if (node.desiredDepth === "undecided") gaps.push("The learner has not selected a learning depth.");
    if (verifications.length === 0) gaps.push("No verification attempt is recorded.");
    if (verifications.length > 0 && acceptedEvidence.length === 0) gaps.push("No accepted closed-book verification exists.");
    const recommendedAction = unmetPrerequisites.length
      ? "Learn the unmet prerequisites first."
      : node.desiredDepth === "undecided"
        ? "Ask the learner to choose overview, master, deep, or skip."
        : node.status === "unassessed"
          ? "Run a short diagnostic before teaching."
          : node.status === "verified"
            ? "Apply the concept in the goal context or schedule a later transfer check."
            : "Teach only the identified gap, then use a novel closed-book transfer prompt.";
    return {
      node: summarizeNode(node),
      memberships,
      unmetPrerequisites,
      evidence: {
        attempts: verifications.length,
        accepted: acceptedEvidence.length,
        latest: verifications.at(-1) ?? null,
      },
      gaps,
      recommendedAction,
    };
  }

  private computeQueue(forest: Forest, goalId: string | undefined, limit: number): Record<string, unknown> {
    const nodes = nodeMap(forest);
    const goals = goalId ? forest.goals.filter((goal) => goal.id === goalId) : forest.goals;
    const rows = goals.flatMap((goal) => goal.nodeRefs.map((ref) => {
      const node = nodes.get(ref.nodeId);
      if (!node || node.status === "verified" || node.status === "parked" || node.desiredDepth === "skip") return null;
      const unmet = ref.prerequisites.filter((id) => nodes.get(id)?.status !== "verified");
      return {
        goalId: goal.id,
        goalTitle: goal.title,
        node: summarizeNode(node),
        importance: ref.importance,
        recommendedDepth: ref.recommendedDepth,
        why: ref.why,
        unmetPrerequisiteIds: unmet,
      };
    })).filter((row): row is NonNullable<typeof row> => Boolean(row));
    const rank: Record<Importance, number> = { required: 0, conditional: 1, optional: 2 };
    rows.sort((a, b) => a.unmetPrerequisiteIds.length - b.unmetPrerequisiteIds.length
      || rank[a.importance] - rank[b.importance]
      || String(a.node?.title).localeCompare(String(b.node?.title)));
    return {
      ready: rows.filter((row) => row.unmetPrerequisiteIds.length === 0).slice(0, limit),
      blocked: rows.filter((row) => row.unmetPrerequisiteIds.length > 0).slice(0, limit),
    };
  }
}

function requiredNode(forest: Forest, nodeId: string): KnowledgeNode {
  const node = forest.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`Unknown knowledge node: ${nodeId}`);
  return node;
}

function summarizeNode(node: KnowledgeNode | undefined): Record<string, unknown> | null {
  if (!node) return null;
  return {
    id: node.id,
    title: node.title,
    domain: node.domain,
    desiredDepth: node.desiredDepth,
    status: node.status,
    tags: node.tags,
  };
}

function searchScore(node: KnowledgeNode, terms: string[]): number {
  if (terms.length === 0) return 0;
  const title = node.title.toLocaleLowerCase();
  const domain = node.domain.toLocaleLowerCase();
  const description = node.description.toLocaleLowerCase();
  const tags = node.tags.join(" ").toLocaleLowerCase();
  const notes = node.notes.toLocaleLowerCase();
  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += 8;
    if (domain.includes(term)) score += 4;
    if (tags.includes(term)) score += 3;
    if (description.includes(term)) score += 2;
    if (notes.includes(term)) score += 1;
  }
  return score;
}
