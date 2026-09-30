// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnalyticsProvider } from "@/lib/analytics/browser";
import { RepeatPlan } from "@/features/entry/components/repeat-plan";
const track = vi.fn(async (...args: unknown[]) => args);
vi.mock("@/features/entry/client", () => ({
  requestApi: (...args: unknown[]) => track(...args),
}));
afterEach(() => {
  cleanup();
  track.mockClear();
});
describe("repeat creation", () => {
  it.each(["invite", "result"] as const)(
    "tracks a bounded %s event only on click",
    async (surface) => {
      render(
        <AnalyticsProvider enabled>
          <RepeatPlan surface={surface} />
        </AnalyticsProvider>,
      );
      expect(track).not.toHaveBeenCalled();
      const link = screen.getByRole("link", { name: "Create your own plan" });
      expect(link).toHaveAttribute("href", "/");
      await userEvent.setup().click(link);
      expect(track).toHaveBeenCalledWith(
        "/api/analytics",
        "POST",
        { name: "new_intent_from_invite", surface },
        { keepalive: true },
      );
    },
  );
  it("keeps disabled analytics silent", async () => {
    render(<RepeatPlan surface="invite" />);
    await userEvent
      .setup()
      .click(screen.getByRole("link", { name: "Create your own plan" }));
    expect(track).not.toHaveBeenCalled();
  });
});
