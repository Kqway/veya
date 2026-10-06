import { z } from "zod";
import { goalSpecSchema } from "./schema";
import { toolNames } from "./tools";
export const goalPlanningInputSchema = z
  .object({
    spec: goalSpecSchema,
    next: z.enum(toolNames),
    revision: z.number().int().min(0).max(3),
  })
  .strict();
export type GoalPlanningInput = z.infer<typeof goalPlanningInputSchema>;
