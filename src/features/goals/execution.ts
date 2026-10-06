import "server-only";
import { z } from "zod";
import type { DatabaseExecutor } from "@/lib/db/types";
import type { GoalRow } from "./repository";
import { MockOpportunityConnector } from "./connectors";
import {
  toolNames,
  toolRegistry,
  toolInputSchema,
  type ToolName,
  type ToolInput,
  type ToolRisk,
} from "./tools";
export interface ToolContext {
  tx: DatabaseExecutor;
  goal: GoalRow;
  step: { id: string; actionKey: string };
}
export interface VeyaTool<I, O, C = ToolContext> {
  name: ToolName;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  riskLevel: ToolRisk;
  idempotent: true;
  transactional: true;
  execute(context: C, input: I): Promise<O>;
}
export const observationSchema = z
  .object({
    next: z.enum(toolNames),
    reference: z.string().min(1).max(200),
    description: z.string().min(1).max(500),
    wait: z.boolean().optional(),
    revision: z.number().int().min(0).max(3).optional(),
    paid: z.boolean().optional(),
  })
  .strict();
export type ToolObservation = z.infer<typeof observationSchema>;
/** Only registered, local transactional adapters may enter this worker. Network adapters
 * need a separate claim / I/O / reconciliation boundary before they can be installed. */
export class ToolExecutionRegistry {
  private readonly tools = new Map<
    ToolName,
    VeyaTool<ToolInput, ToolObservation>
  >();
  register(tool: VeyaTool<ToolInput, ToolObservation>) {
    if (
      !toolNames.includes(tool.name) ||
      this.tools.has(tool.name) ||
      tool.riskLevel !== toolRegistry[tool.name].risk ||
      tool.idempotent !== true ||
      tool.transactional !== true
    )
      throw new Error("Unsafe or duplicate tool registration");
    this.tools.set(tool.name, tool);
  }
  async execute(
    name: ToolName,
    context: ToolContext,
    input: unknown,
  ): Promise<ToolObservation> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error("Unregistered tool");
    const checked = tool.inputSchema.parse(input);
    if (name !== "search_people" && checked.amountMinor <= 0)
      throw new Error("Invalid monetary tool amount");
    if (
      checked.goalKey !== context.goal.public_key ||
      checked.cycle !== context.goal.cycle ||
      checked.revision !== context.goal.revision
    )
      throw new Error("Tool scope mismatch");
    const output = tool.outputSchema.parse(
      await tool.execute(context, checked),
    );
    const evidence = observationSchema.parse(output);
    if (evidence.paid && name !== "payment")
      throw new Error("Invalid payment authority");
    return evidence;
  }
}
const registry = new ToolExecutionRegistry();
for (const name of toolNames.filter((name) => name !== "search_people"))
  registry.register({
    name,
    inputSchema: toolInputSchema,
    outputSchema: observationSchema,
    riskLevel: toolRegistry[name].risk,
    idempotent: true,
    transactional: true,
    execute: (context) =>
      new MockOpportunityConnector().execute(
        context.tx,
        context.goal,
        context.step,
      ),
  });
export function executeRegisteredTool(
  name: ToolName,
  context: ToolContext,
  input: unknown,
) {
  return registry.execute(name, context, input);
}
