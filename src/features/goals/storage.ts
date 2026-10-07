import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { DatabaseExecutor } from "@/lib/db/types";
export interface StoredArtifact {
  reference: string;
  checksum: string;
  byteSize: number;
}
export interface ArtifactStorage {
  put(goalId: string, content: string): Promise<StoredArtifact>;
  get(reference: string): Promise<string>;
  erase(goalId: string): Promise<void>;
}
const uuid = /^[0-9a-f-]{36}$/;
/** Small private Markdown documents only. Large files belong in object storage. */
export class PostgresDocumentStorage implements ArtifactStorage {
  constructor(private readonly db: DatabaseExecutor) {}
  async put(goalId: string, content: string): Promise<StoredArtifact> {
    if (!uuid.test(goalId)) throw new Error("Invalid artifact owner");
    const byteSize = Buffer.byteLength(content);
    if (byteSize < 1 || byteSize > 16384)
      throw new Error("Document exceeds storage limit");
    const checksum = createHash("sha256").update(content).digest("hex");
    await this.db.query(
      "INSERT INTO agent_document_contents(goal_id,checksum,content) VALUES($1,$2,$3) ON CONFLICT(goal_id,checksum) DO NOTHING",
      [goalId, checksum, content],
    );
    return { reference: goalId + "/" + checksum, checksum, byteSize };
  }
  async get(reference: string): Promise<string> {
    if (!/^[0-9a-f-]{36}\/[a-f0-9]{64}$/.test(reference))
      throw new Error("Invalid storage reference");
    const [goalId, checksum] = reference.split("/");
    const row = (
      await this.db.query<{ content: string }>(
        "SELECT content FROM agent_document_contents WHERE goal_id=$1 AND checksum=$2",
        [goalId, checksum],
      )
    ).rows[0];
    if (!row) throw new Error("Artifact unavailable");
    if (createHash("sha256").update(row.content).digest("hex") !== checksum)
      throw new Error("Artifact checksum mismatch");
    return row.content;
  }
  async erase(goalId: string): Promise<void> {
    if (!uuid.test(goalId)) throw new Error("Invalid artifact owner");
    await this.db.query(
      "DELETE FROM agent_document_contents WHERE goal_id=$1",
      [goalId],
    );
  }
}
export function artifactStorage(db: DatabaseExecutor): ArtifactStorage {
  const adapter =
    process.env.GOAL_ARTIFACT_STORAGE ??
    (process.env.VERCEL === "1" ? "postgres" : "filesystem");
  if (adapter === "postgres") return new PostgresDocumentStorage(db);
  if (adapter !== "filesystem" || process.env.VERCEL === "1")
    throw new Error("Persistent artifact storage is required");
  return new MockArtifactStorage();
}
export class MockArtifactStorage implements ArtifactStorage {
  constructor(
    private readonly root = resolve(
      /* turbopackIgnore: true */ process.env.GOAL_ARTIFACT_DIR ??
        ".data/goal-artifacts",
    ),
  ) {}
  async put(goalId: string, content: string): Promise<StoredArtifact> {
    if (!uuid.test(goalId)) throw new Error("Invalid artifact owner");
    const byteSize = Buffer.byteLength(content);
    if (byteSize < 1 || byteSize > 1000000)
      throw new Error("Invalid artifact size");
    const checksum = createHash("sha256").update(content).digest("hex"),
      dir = join(this.root, goalId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const target = join(dir, checksum),
      temp = target + "." + randomUUID();
    await writeFile(temp, content, { mode: 0o600 });
    await rename(temp, target);
    return { reference: goalId + "/" + checksum, checksum, byteSize };
  }
  async get(reference: string) {
    if (!/^[0-9a-f-]{36}\/[a-f0-9]{64}$/.test(reference))
      throw new Error("Invalid storage reference");
    const content = await readFile(join(this.root, reference), "utf8");
    if (
      createHash("sha256").update(content).digest("hex") !==
      reference.split("/")[1]
    )
      throw new Error("Artifact checksum mismatch");
    return content;
  }
  async erase(goalId: string) {
    if (!uuid.test(goalId)) throw new Error("Invalid artifact owner");
    await rm(join(this.root, goalId), { recursive: true, force: true });
  }
}
