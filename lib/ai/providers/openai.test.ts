import { afterEach, describe, expect, it, vi } from "vitest";
import { AiGenerationError } from "../provider";
import { OpenAiProvider } from "./openai";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAiProvider", () => {
  it("returns the first choice's message content on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "Here is a recommendation." } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiProvider("sk-test");
    const result = await provider.generate("prompt");

    expect(result).toEqual({ text: "Here is a recommendation." });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer sk-test" }),
      }),
    );
  });

  it("classifies a 403 as an invalid key, not retryable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 403 })),
    );

    const provider = new OpenAiProvider("bad-key");
    await expect(provider.generate("prompt")).rejects.toBeInstanceOf(AiGenerationError);
    await expect(provider.generate("prompt")).rejects.toMatchObject({ outcome: "invalid_key" });
  });

  it("classifies a 429 response as retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 429 })));

    const provider = new OpenAiProvider("sk-test");
    await expect(provider.generate("prompt")).rejects.toMatchObject({ outcome: "retry" });
  });

  it("classifies a 400 response as failed, not retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 400 })));

    const provider = new OpenAiProvider("sk-test");
    await expect(provider.generate("prompt")).rejects.toMatchObject({ outcome: "failed" });
  });

  it("fails when no message content is returned", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200 })));

    const provider = new OpenAiProvider("sk-test");
    await expect(provider.generate("prompt")).rejects.toMatchObject({ outcome: "failed" });
  });
});
