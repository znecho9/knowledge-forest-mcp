import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const buildRoot = resolve(root, ".mcpb-build");
const bundleRoot = resolve(buildRoot, "knowledge-forest-mcp");
const serverRoot = resolve(bundleRoot, "server");
const artifactsRoot = resolve(root, "artifacts");
const artifact = resolve(artifactsRoot, "knowledge-forest-mcp.mcpb");

rmSync(buildRoot, { recursive: true, force: true });
mkdirSync(serverRoot, { recursive: true });
mkdirSync(artifactsRoot, { recursive: true });
rmSync(artifact, { force: true });

cpSync(resolve(root, "mcpb/manifest.json"), resolve(bundleRoot, "manifest.json"));
cpSync(resolve(root, "dist"), resolve(serverRoot, "dist"), { recursive: true });
cpSync(resolve(root, "package.json"), resolve(serverRoot, "package.json"));
cpSync(resolve(root, "LICENSE"), resolve(serverRoot, "LICENSE"));
cpSync(resolve(root, "NOTICE"), resolve(serverRoot, "NOTICE"));

execFileSync("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
  cwd: serverRoot,
  stdio: "inherit"
});

execFileSync("zip", ["-q", "-r", artifact, "."], {
  cwd: bundleRoot,
  stdio: "inherit"
});

const bytes = readFileSync(artifact);
const sha256 = createHash("sha256").update(bytes).digest("hex");
process.stdout.write(`${JSON.stringify({ artifact, bytes: bytes.length, sha256 }, null, 2)}\n`);
