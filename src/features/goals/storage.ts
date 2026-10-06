import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
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
