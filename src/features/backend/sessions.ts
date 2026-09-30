import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { DatabaseExecutor } from "@/lib/db/types";
import { BackendError } from "./errors";

export const GUEST_COOKIE = "veya_guest";
const validToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export async function createGuestSession(db: DatabaseExecutor) {
  const token = randomBytes(32).toString("base64url");
  const result = await db.query<{ expires_at: Date }>(
    "INSERT INTO guest_participant_sessions(token_hash, expires_at) VALUES ($1,now()+interval '30 days') RETURNING expires_at",
    [hash(token)],
  );
  return { token, expiresAt: result.rows[0]!.expires_at.toISOString() };
}

export async function readGuestSession(
  db: DatabaseExecutor,
  token?: string,
  lock = false,
): Promise<{ id: string; expires_at: Date } | null> {
  if (!token || !validToken(token)) return null;
  const result = await db.query<{ id: string; expires_at: Date }>(
    `SELECT id,expires_at FROM guest_participant_sessions WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()${lock ? " FOR SHARE" : ""}`,
    [hash(token)],
  );
  const session = result.rows[0];
  return session && session.expires_at.getTime() > Date.now() ? session : null;
}

export async function findSession(
  db: DatabaseExecutor,
  token?: string,
  lock = false,
): Promise<string | null> {
  return (await readGuestSession(db, token, lock))?.id ?? null;
}

export async function requireSession(
  db: DatabaseExecutor,
  token: string,
): Promise<string> {
  const id = await findSession(db, token, true);
  if (!id) throw new BackendError("UNAUTHORIZED");
  return id;
}

export async function revokeGuestSession(
  db: DatabaseExecutor,
  token: string,
): Promise<void> {
  if (!validToken(token)) return;
  await db.query(
    "UPDATE guest_participant_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL",
    [hash(token)],
  );
}
