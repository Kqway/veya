import { describe, it, expect } from "vitest";
import { interpretGoal } from "@/features/goals/interpreter";
import { assertTransition } from "@/features/goals/state";
import { rollingPlanSchema, planNext } from "@/features/goals/planner";
import { policyDecision } from "@/features/goals/policy";
describe("durable goal primitives", () => {
  it("parses integer minor amounts and currencies", () => {
    expect(interpretGoal("Заработай 10 000 рублей")).toMatchObject({
      targetAmountMinor: 1000000,
      currency: "RUB",
    });
    expect(interpretGoal("Earn $25.50").targetAmountMinor).toBe(2550);
    expect(interpretGoal("Find me friends").type).toBe("unsupported");
  });
  it("does not restart terminal goals", () => {
    expect(() => assertTransition("COMPLETED", "ACTIVE")).toThrow();
    expect(() => assertTransition("ACTIVE", "WAITING_APPROVAL")).not.toThrow();
  });
  it("only permits registered bounded rolling actions", () => {
    expect(
      rollingPlanSchema.safeParse({
        steps: [{ tool: "shell", description: "x" }],
      }).success,
    ).toBe(false);
    expect(planNext("search")).toHaveLength(5);
  });
  it("requires bound financial approval and owner communication budgets", () => {
    expect(policyDecision("FINANCIAL", false, 0, 5)).toBe("approval");
    expect(policyDecision("EXTERNAL_COMMUNICATION", false, 5, 5)).toBe("wait");
    expect(policyDecision("READ", false, 10, 5)).toBe("allow");
  });
});
it("rejects tools without observation evidence and mismatched risk at registration", async () => {
  const { ToolExecutionRegistry, observationSchema } =
    await import("@/features/goals/execution");
  const { toolInputSchema } = await import("@/features/goals/tools");
  const { z } = await import("zod");
  const registry = new ToolExecutionRegistry();
  expect(() =>
    registry.register({
      name: "invoice",
      inputSchema: toolInputSchema,
      outputSchema: observationSchema,
      riskLevel: "READ",
      idempotent: true,
      transactional: true,
      execute: async () => ({
        next: "payment",
        reference: "invoice",
        description: "x",
      }),
    }),
  ).toThrow();
  registry.register({
    name: "search",
    inputSchema: toolInputSchema,
    outputSchema:
      z.custom<import("@/features/goals/execution").ToolObservation>(),
    riskLevel: "READ",
    idempotent: true,
    transactional: true,
    execute: async () => ({
      next: "requirements",
      reference: "",
      description: "No provider evidence",
    }),
  });
  const context = {
    goal: { public_key: "AAAAAAAAAAAAAAAAAAAAAAAA", cycle: 0, revision: 0 },
    step: { id: "step", actionKey: "action" },
    tx: {},
  } as import("@/features/goals/execution").ToolContext;
  await expect(
    registry.execute("search", context, {
      goalKey: "AAAAAAAAAAAAAAAAAAAAAAAA",
      cycle: 0,
      revision: 0,
      amountMinor: 100,
      currency: "RUB",
    }),
  ).rejects.toThrow();
  await expect(registry.execute("payment", context, {})).rejects.toThrow(
    "Unregistered tool",
  );
});
it("filters code, paid datasets and excessive complexity from the bounded mock catalog", async () => {
  const { MockOpportunityConnector } =
    await import("@/features/goals/connectors");
  const candidates = new MockOpportunityConnector().search({
    currency: "RUB",
    amountMinor: 1000000,
    maxSpendMinor: 0,
  });
  expect(candidates).toHaveLength(1);
  expect(candidates[0]).toMatchObject({
    kind: "document",
    complexity: 1,
    spendMinor: 0,
  });
});
it.each([
  "Earn -100 USD",
  "Заработай −100 рублей",
  "Earn $-100",
  "Earn 0 USD",
  "Earn 1000001 RUB",
  "Earn 100 USD or 200 EUR",
  "Earn 100 USD and RUB",
  "Earn 100 GBP",
  "Earn 100 AED",
  "Earn 100 CAD",
  "Earn 10.999 USD",
  "Earn 10 00 RUB",
  "Earn 100 or 200 RUB",
])("blocks negative, out-of-range or ambiguous money intent: %s", (text) => {
  expect(interpretGoal(text).type).toBe("unsupported");
  expect(interpretGoal(text).targetAmountMinor).toBe(0);
});
it.each([
  ["Earn $0.01", 1, "USD"],
  ["Заработай 25,50 евро", 2550, "EUR"],
  ["Заработай 1 000 000 рублей", 100000000, "RUB"],
])("parses supported money exactly: %s", (text, amount, currency) => {
  expect(interpretGoal(String(text))).toMatchObject({
    type: "earn_money",
    targetAmountMinor: amount,
    currency,
  });
});
