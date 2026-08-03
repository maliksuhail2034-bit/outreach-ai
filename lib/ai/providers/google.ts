import { AiGenerationError, type AiGenerationResult, type AiProvider } from "../provider";

// Plain fetch against the Gemini generateContent API — same "no vendor SDK
// for a single request/response call" reasoning as providers/anthropic.ts.
const GOOGLE_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.5-flash";
const MAX_OUTPUT_TOKENS = 1024;
const REQUEST_TIMEOUT_MS = 30_000;

interface GoogleResponseBody {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
}

export class GoogleProvider implements AiProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string = DEFAULT_MODEL,
  ) {}

  async generate(prompt: string): Promise<AiGenerationResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${GOOGLE_API_BASE_URL}/${this.model}:generateContent?key=${this.apiKey}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new AiGenerationError(
        `Gemini request failed: ${error instanceof Error ? error.message : "unknown network error"}`,
        "retry",
      );
    } finally {
      clearTimeout(timeout);
    }

    const body = (await response.json().catch(() => null)) as GoogleResponseBody | null;

    if (response.status === 401 || response.status === 403) {
      throw new AiGenerationError(body?.error?.message ?? "Gemini rejected the connected API key.", "invalid_key");
    }
    if (response.status === 429 || response.status >= 500) {
      throw new AiGenerationError(body?.error?.message ?? `Gemini request failed (${response.status}).`, "retry");
    }
    if (!response.ok) {
      throw new AiGenerationError(body?.error?.message ?? `Gemini request failed (${response.status}).`, "failed");
    }

    const text = body?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
    if (!text) {
      throw new AiGenerationError("Gemini returned no text content.", "failed");
    }
    return { text };
  }
}
