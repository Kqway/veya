import "server-only";
import { z } from "zod";
import type { AiProvider, AiRequest } from "./types";
import {
  parseInputSchema,
  planContextSchema,
  taskDefinitions,
} from "./schemas";
const safeFailure = () => new Error("AI response could not be used.");
async function readEnvelope(response: Response): Promise<unknown> {
  if (!response.ok || Number(response.headers.get("content-length")) > 65_536)
    throw safeFailure();
  const reader = response.body?.getReader();
  if (!reader) throw safeFailure();
  const decoder = new TextDecoder();
  let size = 0,
    text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65_536) {
        await reader.cancel();
        throw safeFailure();
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    reader.releaseLock();
  }
}
const envelopeSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.literal("stop"),
        message: z.object({
          content: z.string().min(1).max(16_000),
          refusal: z.null().optional(),
        }),
      }),
    )
    .min(1),
});
export class OpenAiProvider implements AiProvider {
  readonly name = "openai" as const;
  private readonly fetcher: typeof fetch;
  constructor(
    private readonly options: {
      apiKey: string;
      model?: string;
      fetcher?: typeof fetch;
    },
  ) {
    this.fetcher = options.fetcher ?? fetch;
  }
  async complete(request: AiRequest, signal: AbortSignal): Promise<unknown> {
    const input =
      request.task === "parse_intent" || request.task === "parse_seeking"
        ? parseInputSchema.parse(request.input)
        : planContextSchema.parse(request.input);
    const definition = taskDefinitions[request.task];
    try {
      const response = await this.fetcher(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          signal,
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.options.apiKey}`,
          },
          body: JSON.stringify({
            model: this.options.model ?? "gpt-4.1-mini",
            store: false,
            max_completion_tokens: 1000,
            messages: [
              { role: "system", content: definition.instruction },
              { role: "user", content: JSON.stringify(input) },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: request.task,
                strict: true,
                schema: z.toJSONSchema(definition.schema),
              },
            },
          }),
        },
      );
      const envelope = envelopeSchema.parse(await readEnvelope(response));
      return JSON.parse(envelope.choices[0]!.message.content);
    } catch {
      throw safeFailure();
    }
  }
}
