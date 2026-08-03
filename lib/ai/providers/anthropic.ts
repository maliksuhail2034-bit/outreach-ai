import { AiGenerationError, type AiGenerationResult, type AiProvider } from "../provider";

// Plain fetch against the Messages API — no @anthropic-ai/sdk dependency,
// matching this repo's low-dependency posture (see lib/integrations/providers/webhook.ts
// for the same "a generic HTTP call needs no vendor SDK" reasoning). A BYOK
// key is only ever used for a single request/response here; there's no
// streaming, tool use, or multi-turn state to justify a client library.
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-5";
const MAX_OUTPUT_TOKENS = 1024;
const REQUEST_TIMEOUT_MS = 30_000;

interface AnthropicResponseBody {
  content?: { type: string; text?: string }[];
  error?: { type?: string; message?: string };
}

export class AnthropicProvider implements AiProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string = DEFAULT_MODEL,
  ) {}

  async generate(prompt: string): Promise<AiGenerationResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_API_VERSION,
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
        `Anthropic request failed: ${error instanceof Error ? error.message : "unknown network error"}`,
        "retry",
      );
    } finally {
      clearTimeout(timeout);
    }

    const body = (await response.json().catch(() => null)) as AnthropicResponseBody | null;

    if (response.status === 401 || response.status === 403) {
      throw new AiGenerationError(body?.error?.message ?? "Anthropic rejected the connected API key.", "invalid_key");
    }
    if (response.status === 429 || response.status >= 500) {
      throw new AiGenerationError(body?.error?.message ?? `Anthropic request failed (${response.status}).`, "retry");
    }
    if (!response.ok) {
      throw new AiGenerationError(body?.error?.message ?? `Anthropic request failed (${response.status}).`, "failed");
    }

    const text = body?.content?.find((block) => block.type === "text")?.text;
    if (!text) {
      throw new AiGenerationError("Anthropic returned no text content.", "failed");
    }
    return { text };
  }
}
