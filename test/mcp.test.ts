import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const temporaryDirectories: string[] = [];

after(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

test("negotiates MCP over stdio, lists tools, and calls the overview", async () => {
  const directory = await mkdtemp(join(tmpdir(), "knowledge-forest-mcp-protocol-"));
  temporaryDirectories.push(directory);
  const dataFile = join(directory, "forest.json");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/cli.ts", "serve", "--data-file", dataFile],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const client = new Client({ name: "knowledge-forest-test", version: "1.0.0" });

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    assert.ok(names.includes("forest_overview"));
    assert.ok(names.includes("record_verification"));
    assert.ok(names.includes("export_forest"));

    const result = await client.callTool({ name: "forest_overview", arguments: {} });
    assert.equal(result.isError, undefined);
    const structured = result.structuredContent as { counts?: { goals?: number; nodes?: number } };
    assert.equal(structured.counts?.goals, 0);
    assert.equal(structured.counts?.nodes, 0);
  } finally {
    await client.close();
  }
});
