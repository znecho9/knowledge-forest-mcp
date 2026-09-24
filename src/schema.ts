import * as z from "zod/v4";

export const depthSchema = z.enum(["undecided", "skip", "overview", "master", "deep"]);
export const recommendedDepthSchema = z.enum(["overview", "master", "deep"]);
export const statusSchema = z.enum(["unassessed", "queued", "learning", "verifying", "verified", "parked"]);
export const mutableStatusSchema = z.enum(["unassessed", "queued", "learning", "verifying", "parked"]);
export const importanceSchema = z.enum(["required", "conditional", "optional"]);
export const verificationOutcomeSchema = z.enum(["not-demonstrated", "partial", "demonstrated"]);

const idSchema = z.string().min(1).max(120).regex(/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u, "Use Unicode letters, numbers, dots, underscores, or hyphens.");
const timestampSchema = z.string().datetime({ offset: true });

export const knowledgeNodeSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1).max(200),
  domain: z.string().trim().min(1).max(120),
  description: z.string().trim().max(4_000),
  tags: z.array(z.string().trim().min(1).max(60)).max(30),
  desiredDepth: depthSchema,
  status: statusSchema,
  notes: z.string().max(100_000),
  evidence: z.array(idSchema).max(1_000),
  createdAt: timestampSchema,
  updatedAt: timestampSchema.optional(),
}).passthrough();

export const goalNodeRefSchema = z.object({
  nodeId: idSchema,
  branchId: idSchema,
  prerequisites: z.array(idSchema).max(100),
  importance: importanceSchema,
  recommendedDepth: recommendedDepthSchema,
  why: z.string().trim().max(2_000),
  reused: z.boolean(),
}).passthrough();

export const goalBranchSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2_000),
}).passthrough();

export const goalSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4_000),
  outcome: z.string().trim().min(1).max(2_000),
  createdAt: timestampSchema,
  updatedAt: timestampSchema.optional(),
  accent: z.string().max(40),
  branches: z.array(goalBranchSchema).max(50),
  nodeRefs: z.array(goalNodeRefSchema).max(2_000),
}).passthrough();

export const learningEntrySchema = z.object({
  id: idSchema,
  nodeId: idSchema,
  kind: z.enum(["note", "reflection", "source", "exercise"]),
  content: z.string().trim().min(1).max(100_000),
  sourceVisibility: z.enum(["closed-book", "source-visible"]),
  sources: z.array(z.object({
    title: z.string().trim().min(1).max(500),
    url: z.string().url().max(2_000).optional(),
  })).max(100),
  createdAt: timestampSchema,
}).passthrough();

export const verificationEvidenceSchema = z.object({
  id: idSchema,
  nodeId: idSchema,
  prompt: z.string().trim().min(1).max(30_000),
  response: z.string().trim().min(1).max(100_000),
  outcome: verificationOutcomeSchema,
  closedBook: z.boolean(),
  assisted: z.boolean(),
  novelPrompt: z.boolean(),
  accepted: z.boolean(),
  rationale: z.string().trim().min(1).max(10_000),
  createdAt: timestampSchema,
}).passthrough();

export const learningEventSchema = z.object({
  id: idSchema,
  type: z.enum([
    "forest-initialized",
    "goal-created",
    "node-state-changed",
    "learning-note-appended",
    "verification-recorded",
  ]),
  summary: z.string().trim().min(1).max(2_000),
  goalId: idSchema.optional(),
  nodeId: idSchema.optional(),
  createdAt: timestampSchema,
}).passthrough();

export const learningRecordsSchema = z.object({
  entries: z.array(learningEntrySchema).max(100_000),
  verifications: z.array(verificationEvidenceSchema).max(100_000),
  events: z.array(learningEventSchema).max(200_000),
});

export const forestSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative().default(0),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  goals: z.array(goalSchema).max(500),
  nodes: z.array(knowledgeNodeSchema).max(20_000),
  learningRecords: learningRecordsSchema.default({ entries: [], verifications: [], events: [] }),
}).passthrough();

export const forestEnvelopeSchema = z.object({
  format: z.literal("knowledge-forest-backup"),
  version: z.literal(1),
  savedAt: timestampSchema,
  reason: z.string().min(1).max(200),
  forest: forestSchema,
}).passthrough();

export type Depth = z.infer<typeof depthSchema>;
export type RecommendedDepth = z.infer<typeof recommendedDepthSchema>;
export type Status = z.infer<typeof statusSchema>;
export type Importance = z.infer<typeof importanceSchema>;
export type KnowledgeNode = z.infer<typeof knowledgeNodeSchema>;
export type GoalNodeRef = z.infer<typeof goalNodeRefSchema>;
export type GoalBranch = z.infer<typeof goalBranchSchema>;
export type Goal = z.infer<typeof goalSchema>;
export type LearningEntry = z.infer<typeof learningEntrySchema>;
export type VerificationEvidence = z.infer<typeof verificationEvidenceSchema>;
export type LearningEvent = z.infer<typeof learningEventSchema>;
export type Forest = z.infer<typeof forestSchema>;

export const createGoalTreeInputSchema = z.object({
  goal: z.object({
    title: z.string().trim().min(1).max(200).describe("A concrete learning or project goal."),
    description: z.string().trim().max(4_000).describe("Why this goal matters and its scope."),
    outcome: z.string().trim().min(1).max(2_000).describe("An observable definition of done."),
    accent: z.string().max(40).optional().describe("Optional CSS color used by compatible workbenches."),
  }),
  branches: z.array(z.object({
    temp_id: idSchema.describe("A request-local branch ID."),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2_000),
    nodes: z.array(z.object({
      temp_id: idSchema.describe("A request-local node ID referenced by prerequisites."),
      title: z.string().trim().min(1).max(200),
      domain: z.string().trim().min(1).max(120),
      description: z.string().trim().max(4_000),
      tags: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
      why: z.string().trim().max(2_000).describe("Why this node is needed for the goal."),
      importance: importanceSchema,
      recommended_depth: recommendedDepthSchema,
      prerequisites: z.array(idSchema).max(100).default([]).describe("Request-local temp_id values."),
      reuse_node_id: idSchema.nullable().default(null).describe("Existing canonical node ID when the concept is truly equivalent."),
    })).min(1).max(100),
  })).min(1).max(20),
});

export type CreateGoalTreeInput = z.infer<typeof createGoalTreeInputSchema>;
