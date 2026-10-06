import { z } from "zod";
import { toolNames, toolRegistry, type ToolName } from "./tools";
export const rollingPlanSchema = z
  .object({
    steps: z
      .array(
        z
          .object({
            tool: z.enum(toolNames),
            description: z.string().min(1).max(200),
          })
          .strict(),
      )
      .min(1)
      .max(5),
  })
  .strict();
export function planNext(next: ToolName, revision = 0) {
  if (next === "search_people")
    return rollingPlanSchema.parse({
      steps: [{ tool: next, description: toolRegistry[next].description }],
    }).steps;
  const path: ToolName[] = [
    "search",
    "requirements",
    "proposal",
    "client_response",
    "create_artifact",
    "verify_artifact",
    "deliver",
    "delivery_response",
    ...(revision === 0
      ? ([
          "revise_artifact",
          "verify_artifact",
          "deliver",
          "delivery_response",
        ] as ToolName[])
      : []),
    "invoice",
    "payment",
  ];
  const start = path.indexOf(next);
  if (start < 0) throw new Error("No supported next step");
  return rollingPlanSchema.parse({
    steps: path
      .slice(start, start + 5)
      .map((tool) => ({ tool, description: toolRegistry[tool].description })),
  }).steps;
}
