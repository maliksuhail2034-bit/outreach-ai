import { afterEach, describe, expect, it, vi } from "vitest";
import { AiGenerationError } from "../provider";
import { AnthropicProvider } from "./anthropic";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AnthropicProvider", () => {
  it("returns the first text content block on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: "text", text: "Here is a recommendation." }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new AnthropicProvider("sk-ant-test");
    const result = await provider.generate("prompt");

    expect(result).toEqual({ text: "Here is a recommendation." });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-api-key": "sk-ant-test" }),
      }),
    );
  });

  it("classifies a 401 as an invalid key, not retryable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401 })),
    );

    const provider = new AnthropicProvider("bad-key");
    await expect(provider.generate("prompt")).rejects.toBeInstanceOf(AiGenerationError);
    await expect(provider.generate("prompt")).rejects.toMatchObject({ outcome: "invalid_key" });
  });

  it("classifies a 5xx response as retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 503 })));

    const provider = new AnthropicProvider("sk-ant-test");
    await expect(provider.generate("prompt")).rejects.toMatchObject({ outcome: "retry" });
  });

  it("classifies a network error as retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const provider = new AnthropicProvider("sk-ant-test");
    await expect(provider.generate("prompt")).rejects.toMatchObject({ outcome: "retry" });
  });

  it("fails when no text content is returned", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [] }), { status: 200 })));

    const provider = new AnthropicProvider("sk-ant-test");
    await expect(provider.generate("prompt")).rejects.toMatchObject({ outcome: "failed" });
  });
});
