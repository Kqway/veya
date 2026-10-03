import { afterEach, expect, it, vi } from "vitest";
import { apiError, HttpError } from "@/features/backend/http";
import { BetaPolicyError } from "@/lib/config/beta-policy";

afterEach(() => vi.restoreAllMocks());
it("records unexpected API failures as a fixed operational event without secret error data", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const response = apiError(new Error("postgres://private-user:private-password@db/private message private-location"));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: { code: "SERVICE_UNAVAILABLE", message: "Сервис временно недоступен." } });
  expect(logged).toHaveBeenCalledTimes(1);
  expect(JSON.parse(logged.mock.calls[0]![0] as string)).toEqual({ event: "api_unavailable", occurrences: 1 });
});
it("keeps operator maintenance, auth, validation and moderation configuration outcomes outside failure logs", () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  apiError(new BetaPolicyError("BETA_READ_ONLY", "Temporarily read-only."));
  apiError(new HttpError(401, "ADMIN_UNAUTHORIZED", "Authorized moderator required."));
  apiError(new HttpError(400, "INVALID_INPUT", "Invalid input."));
  apiError(new HttpError(503, "MODERATION_UNAVAILABLE", "Moderation is unavailable."));
  expect(logged).not.toHaveBeenCalled();
});
