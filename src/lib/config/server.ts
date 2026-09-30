import "server-only";
import { parseServerEnv, type ServerEnv } from "./env";

/** Read lazily so builds and routes without external services need no secrets. */
export function getServerEnv(): ServerEnv {
  return parseServerEnv(process.env);
}
