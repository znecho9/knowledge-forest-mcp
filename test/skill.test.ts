import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const skillDirectory = join(root, ".agents", "skills", "knowledge-forest");
const skill = readFileSync(join(skillDirectory, "SKILL.md"), "utf8");
const reference = readFileSync(join(skillDirectory, "references", "mcp-tools.md"), "utf8");
const server = readFileSync(join(root, "src", "server.ts"), "utf8");

type EvalCase = {
  id: string;
  category: "positive" | "negative" | "safety" | "failure";
  prompt: string;
  shouldActivate: boolean;
  expectedTools: string[];
  mustNotCall: string[];
  passCriteria: string;
};

const evalCases = JSON.parse(
  readFileSync(join(root, "test", "fixtures", "skill-evals.json"), "utf8"),
) as EvalCase[];

function frontmatterValue(block: string, key: string): string {
  const line = block.split(/\r?\n/).find((value) => value.startsWith(`${key}: `));
  assert.ok(line, `Missing frontmatter key: ${key}`);
  return line.slice(key.length + 2).replace(/^["']|["']$/g, "");
}

const registeredTools = Array.from(
  server.matchAll(/server\.registerTool\(\s*"([a-z_]+)"/g),
  (match) => match[1]!,
);

test("Agent Skills frontmatter and directory follow the portable specification", () => {
  const match = skill.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert.ok(match, "SKILL.md needs closed YAML frontmatter at the start");
  const frontmatter = match[1]!;
  const name = frontmatterValue(frontmatter, "name");
  const description = frontmatterValue(frontmatter, "description");
  const compatibility = frontmatterValue(frontmatter, "compatibility");

  assert.match(name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.equal(name, "knowledge-forest");
  assert.ok(name.length <= 64);
  assert.ok(description.length > 30 && description.length <= 1024);
  assert.match(description, /use when/i);
  assert.ok(compatibility.length > 0 && compatibility.length <= 500);
  assert.equal(frontmatterValue(frontmatter, "license"), "Apache-2.0");
  assert.ok(skill.slice(match[0].length).startsWith("# Knowledge Forest:"));
  assert.ok(skill.split(/\r?\n/).length < 500);
  assert.ok(!/\/Users\/[^\s]+|@gmail\.com|PLACEHOLDER|TODO:/i.test(skill));
});

test("Skill workflow covers persistence, reuse, provenance, verification and failures", () => {
  const sections = [
    "When to activate",
    "When not to activate",
    "Connection and authority",
    "Workflow A: Plan a durable goal",
    "Workflow B: Resume and diagnose before teaching",
    "Workflow C: Save study and research records",
    "Workflow D: Assess, then verify mastery",
    "Safety, failure handling, and reporting",
  ];
  for (const section of sections) {
    assert.ok(skill.includes(`## ${section}`), `Missing section ${section}`);
  }
  assert.match(skill, /Obtain approval before calling `create_goal_tree`/);
  assert.match(skill, /source_visibility: source-visible/);
  assert.match(skill, /actual response/i);
  assert.match(skill, /accepted: true/);
  assert.match(skill, /read back current state before retrying/i);
  assert.match(skill, /untrusted data/i);
  assert.match(skill, /do not pretend to read or save anything/i);
  assert.match(skill, /references\/mcp-tools\.md/);
});

test("MCP reference enumerates the exact registered tool names", () => {
  const documentedTools = Array.from(
    reference.matchAll(/^\|\s*`([a-z_]+)`\s*\|/gm),
    (match) => match[1]!,
  );
  assert.equal(new Set(registeredTools).size, registeredTools.length);
  assert.deepEqual(documentedTools.slice().sort(), registeredTools.slice().sort());
  assert.equal(documentedTools.length, 10);
  assert.match(reference, /request-local `temp_id`/);
  assert.match(reference, /closed_book/);
  assert.match(reference, /assisted/);
  assert.match(reference, /novel_prompt/);
  assert.match(reference, /non-idempotent/i);
});

test("Internal eval cases cover activation, non-activation, safety and disconnection", () => {
  assert.ok(Array.isArray(evalCases));
  assert.ok(evalCases.length >= 12);
  assert.equal(new Set(evalCases.map((item) => item.id)).size, evalCases.length);

  const allowedCategories = new Set(["positive", "negative", "safety", "failure"]);
  const tools = new Set(registeredTools);
  for (const item of evalCases) {
    assert.match(item.id, /^[a-z0-9-]+$/);
    assert.ok(allowedCategories.has(item.category));
    assert.ok(item.prompt.length >= 20);
    assert.equal(typeof item.shouldActivate, "boolean");
    assert.ok(item.passCriteria.length >= 25);
    for (const name of [...item.expectedTools, ...item.mustNotCall]) {
      assert.ok(tools.has(name), `Unknown tool ${name} in eval ${item.id}`);
    }
    assert.equal(new Set(item.expectedTools).size, item.expectedTools.length);
    assert.equal(new Set(item.mustNotCall).size, item.mustNotCall.length);
    assert.equal(item.expectedTools.filter((name) => item.mustNotCall.includes(name)).length, 0);
    if (!item.shouldActivate) assert.equal(item.expectedTools.length, 0);
  }

  assert.ok(evalCases.filter((item) => item.shouldActivate).length >= 8);
  assert.ok(evalCases.filter((item) => !item.shouldActivate).length >= 4);
  assert.ok(evalCases.some((item) => item.id === "mcp-unavailable"));
  assert.ok(evalCases.some((item) => item.id === "assisted-is-not-mastery"));
  assert.ok(evalCases.some((item) => item.id === "source-injection"));
});

// These tests validate the manifest and declared tool contract only.
// The prompts in skill-evals.json require separate real-agent, isolated-data
// runs to measure skill activation and behavioral compliance.
