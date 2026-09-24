import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { assertForestIntegrity, emptyForest, nowIso } from "./domain.js";
import { forestSchema, learningRecordsSchema, type Forest } from "./schema.js";

const LOCK_STALE_MS = 30_000;
const LOCK_ATTEMPTS = 75;
const BACKUP_LIMIT = 20;

export type StoreOptions = {
  dataFile?: string;
  dataDir?: string;
};

export function resolveDataFile(options: StoreOptions = {}): string {
  if (options.dataFile) return resolve(options.dataFile);
  if (process.env.KNOWLEDGE_FOREST_FILE) return resolve(process.env.KNOWLEDGE_FOREST_FILE);
  const dataDir = options.dataDir ?? process.env.KNOWLEDGE_FOREST_HOME ?? join(homedir(), ".knowledge-forest");
  return resolve(dataDir, "knowledge-forest.json");
}

type UpdateResult<T> = { forest: Forest; result: T };

export class ForestStore {
  readonly dataFile: string;
  readonly recordsFile: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: StoreOptions = {}) {
    this.dataFile = resolveDataFile(options);
    const extension = extname(this.dataFile);
    const stem = basename(this.dataFile, extension);
    this.recordsFile = join(dirname(this.dataFile), `${stem}.mcp-records.json`);
  }

  async initialize(): Promise<Forest> {
    const existing = await this.readIfPresent();
    if (existing) return existing;
    return this.enqueue(async () => this.withLock(async () => {
      const current = await this.readIfPresent();
      if (current) return current;
      const forest = emptyForest();
      await this.write(forest, "initialize", false);
      return forest;
    }));
  }

  async load(): Promise<Forest> {
    return (await this.readIfPresent()) ?? this.initialize();
  }

  async update<T>(reason: string, mutate: (forest: Forest) => T | Promise<T>): Promise<UpdateResult<T>> {
    return this.enqueue(async () => this.withLock(async () => {
      const baseline = (await this.readIfPresent()) ?? emptyForest();
      const draft = structuredClone(baseline);
      const result = await mutate(draft);
      const at = nowIso();
      draft.revision = baseline.revision + 1;
      draft.updatedAt = at;
      const validated = forestSchema.parse(draft);
      assertForestIntegrity(validated);
      await this.write(validated, reason, true);
      return { forest: validated, result };
    }));
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(task, task);
    this.writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async readIfPresent(): Promise<Forest | null> {
    let source: string;
    try {
      source = await readFile(this.dataFile, "utf8");
    } catch (error) {
      if (hasCode(error, "ENOENT")) return null;
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch (error) {
      throw new Error(`Knowledge Forest data is not valid JSON: ${this.dataFile}`, { cause: error });
    }

    const rawEnvelope = isRecord(parsed) && isRecord(parsed.forest) ? parsed : null;
    const rawForest = rawEnvelope?.forest ?? parsed;
    if (!isRecord(rawForest)) throw new Error(`Knowledge Forest data has no forest object: ${this.dataFile}`);
    const createdAt = firstCreatedAt(rawForest) ?? nowIso();
    const embedded = {
      revision: 0,
      createdAt,
      updatedAt: typeof rawEnvelope?.savedAt === "string" ? rawEnvelope.savedAt : createdAt,
      learningRecords: { entries: [], verifications: [], events: [] },
      ...rawForest,
    };
    const sidecar = await this.readRecordsIfPresent();
    const embeddedRevision = typeof embedded.revision === "number" ? embedded.revision : 0;
    const normalized = sidecar && sidecar.revision >= embeddedRevision
      ? {
          ...embedded,
          revision: sidecar.revision,
          createdAt: sidecar.createdAt,
          updatedAt: sidecar.updatedAt,
          learningRecords: sidecar.learningRecords,
        }
      : embedded;
    const forest = forestSchema.parse(normalized);
    assertForestIntegrity(forest);
    return forest;
  }

  private async write(forest: Forest, reason: string, createBackup: boolean): Promise<void> {
    const dataDir = dirname(this.dataFile);
    await mkdir(dataDir, { recursive: true });
    if (createBackup && await exists(this.dataFile)) await this.backupCurrent(dataDir);
    const savedAt = nowIso();
    const envelope = {
      format: "knowledge-forest-backup",
      version: 1,
      savedAt,
      reason,
      forest,
    };
    const tempFile = `${this.dataFile}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(tempFile, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(tempFile, this.dataFile);
    const recordsEnvelope = {
      format: "knowledge-forest-mcp-records",
      version: 1,
      revision: forest.revision,
      createdAt: forest.createdAt,
      updatedAt: forest.updatedAt,
      learningRecords: forest.learningRecords,
    };
    const recordsTempFile = `${this.recordsFile}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(recordsTempFile, `${JSON.stringify(recordsEnvelope, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(recordsTempFile, this.recordsFile);
  }

  private async backupCurrent(dataDir: string): Promise<void> {
    const backupDir = join(dataDir, "backups");
    await mkdir(backupDir, { recursive: true });
    const stamp = nowIso().replace(/[:.]/g, "-");
    await copyFile(this.dataFile, join(backupDir, `mcp-before-${stamp}.json`));
    if (await exists(this.recordsFile)) {
      await copyFile(this.recordsFile, join(backupDir, `mcp-records-before-${stamp}.json`));
    }
    const backups = (await readdir(backupDir))
      .filter((name) => name.startsWith("mcp-before-") && name.endsWith(".json"))
      .sort()
      .reverse();
    await Promise.all(backups.slice(BACKUP_LIMIT).map((name) => unlink(join(backupDir, name))));
    const recordBackups = (await readdir(backupDir))
      .filter((name) => name.startsWith("mcp-records-before-") && name.endsWith(".json"))
      .sort()
      .reverse();
    await Promise.all(recordBackups.slice(BACKUP_LIMIT).map((name) => unlink(join(backupDir, name))));
  }

  private async readRecordsIfPresent(): Promise<{
    revision: number;
    createdAt: string;
    updatedAt: string;
    learningRecords: Forest["learningRecords"];
  } | null> {
    let source: string;
    try {
      source = await readFile(this.recordsFile, "utf8");
    } catch (error) {
      if (hasCode(error, "ENOENT")) return null;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch (error) {
      throw new Error(`Knowledge Forest MCP records are not valid JSON: ${this.recordsFile}`, { cause: error });
    }
    if (!isRecord(parsed) || parsed.format !== "knowledge-forest-mcp-records" || parsed.version !== 1) {
      throw new Error(`Knowledge Forest MCP records have an unsupported format: ${this.recordsFile}`);
    }
    if (typeof parsed.revision !== "number" || typeof parsed.createdAt !== "string" || typeof parsed.updatedAt !== "string") {
      throw new Error(`Knowledge Forest MCP records are missing revision metadata: ${this.recordsFile}`);
    }
    return {
      revision: parsed.revision,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
      learningRecords: learningRecordsSchema.parse(parsed.learningRecords),
    };
  }

  private async withLock<T>(task: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.dataFile), { recursive: true });
    const lockFile = `${this.dataFile}.lock`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
      try {
        handle = await open(lockFile, "wx", 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: nowIso() }), "utf8");
        break;
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
        if (await isStaleLock(lockFile)) {
          await unlink(lockFile).catch((unlinkError: unknown) => {
            if (!hasCode(unlinkError, "ENOENT")) throw unlinkError;
          });
          continue;
        }
        await delay(40);
      }
    }
    if (!handle) throw new Error(`Knowledge Forest is busy; could not acquire lock: ${lockFile}`);
    try {
      return await task();
    } finally {
      await handle.close();
      await unlink(lockFile).catch((error: unknown) => {
        if (!hasCode(error, "ENOENT")) throw error;
      });
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstCreatedAt(forest: Record<string, unknown>): string | null {
  const candidates: string[] = [];
  for (const key of ["goals", "nodes"] as const) {
    const items = forest[key];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (isRecord(item) && typeof item.createdAt === "string") candidates.push(item.createdAt);
    }
  }
  return candidates.sort()[0] ?? null;
}

function hasCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === code;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}

async function isStaleLock(path: string): Promise<boolean> {
  try {
    const details = await stat(path);
    return Date.now() - details.mtimeMs > LOCK_STALE_MS;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
