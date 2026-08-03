import { afterEach, describe, expect, it, vi } from "vitest";
import { AiGenerationError } from "../provider";
import { GoogleProvider } from "./google";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GoogleProvider", () => {
  it("joins and returns the first candidate's text parts on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "Here is " }, { text: "a recommendation." }] } }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GoogleProvider("AIza-test");
    const result = await provider.generate("prompt");

    expect(result).toEqual({ text: "Here is a recommendation." });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("key=AIza-test"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("classifies a 401 as an invalid key, not retryable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401 })),
    );

    const provider = new GoogleProvider("bad-key");
    await expect(provider.generate("prompt")).rejects.toBeInstanceOf(AiGenerationError);
    await expect(provider.generate("prompt")).rejects.toMatchObject({ outcome: "invalid_key" });
  });

  it("classifies a 5xx response as retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 500 })));

    const provider = new GoogleProvider("AIza-test");
    await expect(provider.generate("prompt")).rejects.toMatchObject({ outcome: "retry" });
  });

  it("fails when no candidates are returned", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [] }), { status: 200 })));

    const provider = new GoogleProvider("AIza-test");
    await expect(provider.generate("prompt")).rejects.toMatchObject({ outcome: "failed" });
  });
});
