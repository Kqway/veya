import { backendHandlers } from "@/features/backend/runtime";

export const runtime = "nodejs";
export const POST = backendHandlers.createSession;
export const DELETE = backendHandlers.revokeSession;
