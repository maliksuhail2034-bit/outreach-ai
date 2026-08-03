import { AiGenerationError, type AiGenerationResult, type AiProvider } from "../provider";

// Plain fetch against the Chat Completions API — same "no vendor SDK for a
// single request/response call" reasoning as providers/anthropic.ts.
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";
const MAX_OUTPUT_TOKENS = 1024;
const REQUEST_TIMEOUT_MS = 30_000;

interface OpenAiResponseBody {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

export class OpenAiProvider implements AiProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string = DEFAULT_MODEL,
  ) {}

  async generate(prompt: string): Promise<AiGenerationResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new AiGenerationError(
        `OpenAI request failed: ${error instanceof Error ? error.message : "unknown network error"}`,
        "retry",
      );
    } finally {
      clearTimeout(timeout);
    }

    const body = (await response.json().catch(() => null)) as OpenAiResponseBody | null;

    if (response.status === 401 || response.status === 403) {
      throw new AiGenerationError(body?.error?.message ?? "OpenAI rejected the connected API key.", "invalid_key");
    }
    if (response.status === 429 || response.status >= 500) {
      throw new AiGenerationError(body?.error?.message ?? `OpenAI request failed (${response.status}).`, "retry");
    }
    if (!response.ok) {
      throw new AiGenerationError(body?.error?.message ?? `OpenAI request failed (${response.status}).`, "failed");
    }

    const text = body?.choices?.[0]?.message?.content;
    if (!text) {
      throw new AiGenerationError("OpenAI returned no message content.", "failed");
    }
    return { text };
  }
}
