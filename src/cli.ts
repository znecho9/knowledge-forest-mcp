#!/usr/bin/env node

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createKnowledgeForestServer } from "./server.js";
import { ForestService } from "./service.js";
import { ForestStore, type StoreOptions } from "./store.js";

type ParsedArgs = StoreOptions & { command: string; help: boolean };

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const options: StoreOptions = {
    ...(args.dataFile ? { dataFile: args.dataFile } : {}),
    ...(args.dataDir ? { dataDir: args.dataDir } : {}),
  };
  const store = new ForestStore(options);

  switch (args.command) {
    case "serve": {
      const handle = serveStdio(() => createKnowledgeForestServer(options));
      console.error(`Knowledge Forest MCP is listening on stdio (${store.dataFile})`);
      const shutdown = (): void => {
        void handle.close().finally(() => process.exit(0));
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
      return;
    }
    case "init": {
      const forest = await store.initialize();
      process.stdout.write(`${JSON.stringify({ ok: true, dataFile: store.dataFile, recordsFile: store.recordsFile, revision: forest.revision }, null, 2)}\n`);
      return;
    }
    case "doctor": {
      const forest = await store.load();
      const service = new ForestService(store);
      const overview = await service.overview();
      process.stdout.write(`${JSON.stringify({ ok: true, node: process.version, dataFile: store.dataFile, recordsFile: store.recordsFile, overview }, null, 2)}\n`);
      return;
    }
    case "export": {
      const forest = await store.load();
      process.stdout.write(`${JSON.stringify({
        format: "knowledge-forest-backup",
        version: 1,
        savedAt: new Date().toISOString(),
        reason: "export",
        forest,
      }, null, 2)}\n`);
      return;
    }
    case "config": {
      process.stdout.write(configExamples(store.dataFile));
      return;
    }
    default:
      throw new Error(`Unknown command: ${args.command}\n\n${usage()}`);
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  let command = "serve";
  let dataFile: string | undefined;
  let dataDir: string | undefined;
  let help = false;
  let commandSeen = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--data-file") {
      dataFile = requiredValue(argv, ++index, arg);
    } else if (arg === "--data-dir") {
      dataDir = requiredValue(argv, ++index, arg);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!commandSeen) {
      command = arg;
      commandSeen = true;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  if (dataFile && dataDir) throw new Error("Use either --data-file or --data-dir, not both.");
  return {
    command,
    help,
    ...(dataFile ? { dataFile } : {}),
    ...(dataDir ? { dataDir } : {}),
  };
}

function requiredValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (!value || value.startsWith("-")) throw new Error(`${option} requires a value.`);
  return value;
}

function usage(): string {
  return `Knowledge Forest MCP — local-first learning state for AI tutors

Usage:
  knowledge-forest-mcp [serve] [--data-file PATH | --data-dir DIR]
  knowledge-forest-mcp init [--data-file PATH | --data-dir DIR]
  knowledge-forest-mcp doctor [--data-file PATH | --data-dir DIR]
  knowledge-forest-mcp export [--data-file PATH | --data-dir DIR]
  knowledge-forest-mcp config [--data-file PATH | --data-dir DIR]

Environment:
  KNOWLEDGE_FOREST_FILE   Exact path to knowledge-forest.json
  KNOWLEDGE_FOREST_HOME   Directory used when no exact file is set

Default data file:
  ~/.knowledge-forest/knowledge-forest.json
`;
}

function configExamples(dataFile: string): string {
  const command = "npx";
  const args = ["--yes", "github:znecho9/knowledge-forest-mcp"];
  return `# Claude Desktop / compatible JSON hosts
${JSON.stringify({
  mcpServers: {
    "knowledge-forest": {
      command,
      args,
      env: { KNOWLEDGE_FOREST_FILE: dataFile },
    },
  },
}, null, 2)}

# Codex config.toml
[mcp_servers.knowledge-forest]
command = "${command}"
args = [${args.map((item) => JSON.stringify(item)).join(", ")}]
env = { KNOWLEDGE_FOREST_FILE = ${JSON.stringify(dataFile)} }
`;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
