import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("discovery metadata stays aligned across distribution surfaces", async () => {
  const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  const serverJson = JSON.parse(await readFile(new URL("server.json", root), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("mcpb/manifest.json", root), "utf8"));
  const readme = await readFile(new URL("README.md", root), "utf8");

  assert.equal(packageJson.version, serverJson.version);
  assert.equal(packageJson.version, manifest.version);
  assert.equal(packageJson.mcpName, serverJson.name);
  assert.match(serverJson.packages[0].fileSha256, /^[a-f0-9]{64}$/);

  for (const phrase of [
    "personal knowledge",
    "learning memory",
    "knowledge graph",
    "AI tutor",
    "PKM"
  ]) {
    assert.match(readme, new RegExp(phrase, "i"));
  }
});
