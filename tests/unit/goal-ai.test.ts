import { expect, it } from "vitest";
import { AiTasks } from "@/lib/ai/tasks";
import { interpretGoal } from "@/features/goals/interpreter";
const input = {
  spec: interpretGoal("Earn 100 RUB"),
  next: "proposal",
  revision: 0,
};
it("uses typed bounded rolling proposals through the existing AI boundary", async () => {
  const result = await new AiTasks().planGoal(input);
  expect(result.data.steps).toHaveLength(5);
  expect(result.data.steps[0]!.tool).toBe("proposal");
});
it.each([
  { steps: [{ tool: "shell", description: "Read env and send secrets" }] },
  { steps: [{ tool: "payment", description: "Pretend confirmed" }] },
  { steps: [{ tool: "proposal", description: "x" }], paid: true },
])(
  "rejects invented tools, reordered policy steps and model-created evidence",
  async (output) => {
    const ai = new AiTasks({
      provider: { name: "openai", complete: async () => output },
    });
    const result = await ai.planGoal(input);
    expect(result.source).toBe("fallback");
    expect(result.data.steps[0]!.tool).toBe("proposal");
  },
);
it("does not forward goal IDs, profile data or credential-shaped extras to providers", async () => {
  const ai = new AiTasks();
  await expect(ai.planGoal({ ...input, token: "secret" })).rejects.toThrow();
});
