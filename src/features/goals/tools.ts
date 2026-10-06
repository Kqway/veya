import { z } from "zod";
export const toolNames = [
  "search_people",
  "search",
  "requirements",
  "proposal",
  "client_response",
  "create_artifact",
  "verify_artifact",
  "deliver",
  "delivery_response",
  "revise_artifact",
  "invoice",
  "payment",
] as const;
export type ToolName = (typeof toolNames)[number];
export type ToolRisk =
  | "READ"
  | "REVERSIBLE"
  | "EXTERNAL_COMMUNICATION"
  | "FINANCIAL"
  | "LEGAL"
  | "DESTRUCTIVE";
export interface ToolDefinition {
  risk: ToolRisk;
  description: string;
  connector: "mock" | "intent_network";
  idempotent: true;
  input: typeof toolInputSchema;
}
export const toolInputSchema = z
  .object({
    goalKey: z.string().regex(/^[A-Za-z0-9_-]{24}$/),
    cycle: z.number().int().min(0).max(10000),
    revision: z.number().int().min(0).max(3),
    amountMinor: z.number().int().min(0).max(100000000),
    currency: z.enum(["RUB", "USD", "EUR"]),
  })
  .strict();
export type ToolInput = z.infer<typeof toolInputSchema>;
const descriptions: Record<ToolName, string> = {
  search_people: "Ищем совместимые объявления людей",
  search: "Ищем подходящий заказ",
  requirements: "Изучаем требования",
  proposal: "Отправляем предложение",
  client_response: "Ожидаем ответ клиента",
  create_artifact: "Готовим документ",
  verify_artifact: "Проверяем требования",
  deliver: "Передаём результат клиенту",
  delivery_response: "Ожидаем проверку клиента",
  revise_artifact: "Вносим правки клиента",
  invoice: "Выставляем демонстрационный счёт",
  payment: "Ожидаем подтверждение оплаты",
};
export const toolRegistry = Object.fromEntries(
  toolNames.map((name) => [
    name,
    {
      risk:
        name === "invoice"
          ? "FINANCIAL"
          : ["proposal", "deliver"].includes(name)
            ? "EXTERNAL_COMMUNICATION"
            : ["create_artifact", "revise_artifact"].includes(name)
              ? "REVERSIBLE"
              : "READ",
      description: descriptions[name],
      connector: name === "search_people" ? "intent_network" : "mock",
      idempotent: true,
      input: toolInputSchema,
    },
  ]),
) as Record<ToolName, ToolDefinition>;
export const evidenceSchema = z
  .object({
    reference: z.string().min(1).max(200),
    description: z.string().min(1).max(500),
  })
  .strict();
/** Optional future adapters must be scoped by ownership and implement idempotency/reconciliation. */
export interface ExternalAgentAdapter {
  capability: string;
  search(input: {
    needs: readonly string[];
    offers: readonly string[];
  }): Promise<readonly { publicKey: string; description: string }[]>;
}
