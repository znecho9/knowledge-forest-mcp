import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import {
  createGoalTreeInputSchema,
  depthSchema,
  mutableStatusSchema,
  verificationOutcomeSchema,
} from "./schema.js";
import { ForestService } from "./service.js";
import { ForestStore, type StoreOptions } from "./store.js";

const instructions = `Knowledge Forest is a local-first learning-state engine. The connected model does the reasoning; this server stores and retrieves durable state and does not call an LLM.

Workflow:
1. Read forest_overview before planning.
2. Search before creating nodes. Reuse a node only when its concept boundary and expected evidence are truly equivalent.
3. Diagnose before teaching, and teach only the current gap at the learner's selected depth.
4. Source-visible notes are learning material, never mastery evidence.
5. A node becomes verified only through record_verification with a demonstrated, novel, unassisted, closed-book response. Never claim mastery based on conversation fluency alone.
6. Prefer append-only learning records. This v1 server intentionally exposes no delete tool.`;

export function createKnowledgeForestServer(options: StoreOptions = {}): McpServer {
  const store = new ForestStore(options);
  const service = new ForestService(store);
  const server = new McpServer(
    { name: "knowledge-forest", version: "0.1.0" },
    { instructions },
  );

  server.registerTool(
    "forest_overview",
    {
      title: "View knowledge forest overview",
      description: "Read goals, mastery counts, and the next ready knowledge nodes. Call this first; it never modifies learning state.",
      inputSchema: z.object({
        goal_id: z.string().optional().describe("Optional goal ID to scope the overview."),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ goal_id }) => toolResult(() => service.overview(goal_id)),
  );

  server.registerTool(
    "search_knowledge",
    {
      title: "Search knowledge nodes",
      description: "Search canonical nodes before creating a goal tree. Results include reuse context and current mastery state.",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(500),
        limit: z.number().int().min(1).max(100).default(20),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, limit }) => toolResult(() => service.search(query, limit)),
  );

  server.registerTool(
    "get_node_context",
    {
      title: "Get complete node context",
      description: "Read a knowledge node, its goal memberships, prerequisites, dependents, learning entries, verification history, and deterministic diagnosis.",
      inputSchema: z.object({ node_id: z.string().min(1).max(120) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ node_id }) => toolResult(() => service.getNodeContext(node_id)),
  );

  server.registerTool(
    "create_goal_tree",
    {
      title: "Create a minimal sufficient goal tree",
      description: "Persist one observable goal, its branches, and prerequisite-linked knowledge nodes. Search first. Use reuse_node_id only for truly equivalent existing concepts.",
      inputSchema: createGoalTreeInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => toolResult(() => service.createGoalTree(input)),
  );

  server.registerTool(
    "update_node_learning_state",
    {
      title: "Update learning depth or workflow state",
      description: "Set a learner-selected depth or non-verified workflow state. This tool cannot mark mastery; use record_verification for that.",
      inputSchema: z.object({
        node_id: z.string().min(1).max(120),
        desired_depth: depthSchema.optional(),
        status: mutableStatusSchema.optional(),
        reason: z.string().trim().min(1).max(2_000),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ node_id, desired_depth, status, reason }) => toolResult(() => service.updateNodeState({
      nodeId: node_id,
      ...(desired_depth === undefined ? {} : { desiredDepth: desired_depth }),
      ...(status === undefined ? {} : { status }),
      reason,
    })),
  );

  server.registerTool(
    "append_learning_note",
    {
      title: "Append a learning record",
      description: "Append a note, reflection, source, or exercise to a node. Source-visible material never changes mastery state.",
      inputSchema: z.object({
        node_id: z.string().min(1).max(120),
        kind: z.enum(["note", "reflection", "source", "exercise"]),
        content: z.string().trim().min(1).max(100_000),
        source_visibility: z.enum(["closed-book", "source-visible"]),
        sources: z.array(z.object({
          title: z.string().trim().min(1).max(500),
          url: z.string().url().max(2_000).optional(),
        })).max(100).default([]),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ node_id, kind, content, source_visibility, sources }) => toolResult(() => service.appendLearningNote({
      nodeId: node_id,
      kind,
      content,
      sourceVisibility: source_visibility,
      sources: sources.map((source) => ({
        title: source.title,
        ...(source.url === undefined ? {} : { url: source.url }),
      })),
    })),
  );

  server.registerTool(
    "record_verification",
    {
      title: "Record closed-book mastery evidence",
      description: "Record one verification attempt. Mastery advances only for demonstrated, novel, unassisted, closed-book performance; the server computes acceptance.",
      inputSchema: z.object({
        node_id: z.string().min(1).max(120),
        prompt: z.string().trim().min(1).max(30_000),
        response: z.string().trim().min(1).max(100_000),
        outcome: verificationOutcomeSchema,
        closed_book: z.boolean(),
        assisted: z.boolean(),
        novel_prompt: z.boolean(),
        rationale: z.string().trim().min(1).max(10_000),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ node_id, prompt, response, outcome, closed_book, assisted, novel_prompt, rationale }) => toolResult(() => service.recordVerification({
      nodeId: node_id,
      prompt,
      response,
      outcome,
      closedBook: closed_book,
      assisted,
      novelPrompt: novel_prompt,
      rationale,
    })),
  );

  server.registerTool(
    "get_learning_queue",
    {
      title: "Get the actionable learning queue",
      description: "Return ready and prerequisite-blocked nodes, ordered by readiness and importance.",
      inputSchema: z.object({
        goal_id: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(20),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ goal_id, limit }) => toolResult(() => service.learningQueue(goal_id, limit)),
  );

  server.registerTool(
    "diagnose_node",
    {
      title: "Diagnose a knowledge node",
      description: "Deterministically identify prerequisite, depth, and evidence gaps and recommend the next learning action. It does not call a model.",
      inputSchema: z.object({ node_id: z.string().min(1).max(120) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ node_id }) => toolResult(() => service.diagnoseNode(node_id)),
  );

  server.registerTool(
    "export_forest",
    {
      title: "Export the complete forest",
      description: "Read the complete portable forest state, including append-only learning records and evidence.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => toolResult(async () => ({ forest: await store.load(), dataFile: store.dataFile })),
  );

  server.registerPrompt(
    "plan_learning_goal",
    {
      title: "Plan a minimal sufficient learning tree",
      description: "Guide the connected model to turn one outcome into a reusable, prerequisite-aware goal tree.",
      argsSchema: z.object({
        goal: z.string().trim().min(1).max(2_000),
        context: z.string().trim().max(5_000).optional(),
      }),
    },
    async ({ goal, context }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Build a minimal sufficient Knowledge Forest goal tree for: ${goal}\n\nContext: ${context ?? "None provided."}\n\nFirst call forest_overview and search_knowledge for likely reusable concepts. Define an observable outcome, keep only knowledge needed for that outcome, make prerequisites acyclic, and call create_goal_tree. Do not infer mastery from existing notes.`,
        },
      }],
    }),
  );

  return server;
}

async function toolResult(work: () => Promise<unknown>): Promise<{
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
}> {
  try {
    const value = await work();
    const structuredContent = toRecord(value);
    return {
      content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
      structuredContent,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { isError: true, content: [{ type: "text", text: message }] };
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return { value };
}
