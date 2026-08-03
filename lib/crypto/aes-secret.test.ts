import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, parseEncryptionKey } from "./aes-secret";

const KEY_HEX = "0".repeat(64);
const OTHER_KEY_HEX = "1".repeat(64);

describe("parseEncryptionKey", () => {
  it("parses a valid 64-character hex key into a 32-byte buffer", () => {
    const key = parseEncryptionKey("TEST_KEY", KEY_HEX);
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
  });

  it("throws with the env var name when unset", () => {
    expect(() => parseEncryptionKey("TEST_KEY", undefined)).toThrow(/TEST_KEY is not set/);
  });

  it("throws when the key isn't 32 bytes", () => {
    expect(() => parseEncryptionKey("TEST_KEY", "abcd")).toThrow(/must be a 64-character hex string/);
  });
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a plaintext string", () => {
    const key = parseEncryptionKey("TEST_KEY", KEY_HEX);
    const ciphertext = encryptSecret("sk-super-secret-value", key);
    expect(ciphertext).not.toContain("sk-super-secret-value");
    expect(decryptSecret(ciphertext, key)).toBe("sk-super-secret-value");
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const key = parseEncryptionKey("TEST_KEY", KEY_HEX);
    expect(encryptSecret("same-value", key)).not.toBe(encryptSecret("same-value", key));
  });

  it("fails to decrypt with the wrong key", () => {
    const key = parseEncryptionKey("TEST_KEY", KEY_HEX);
    const otherKey = parseEncryptionKey("TEST_KEY", OTHER_KEY_HEX);
    const ciphertext = encryptSecret("sk-super-secret-value", key);
    expect(() => decryptSecret(ciphertext, otherKey)).toThrow();
  });

  it("throws on malformed ciphertext", () => {
    const key = parseEncryptionKey("TEST_KEY", KEY_HEX);
    expect(() => decryptSecret("not-a-valid-ciphertext", key)).toThrow(/Malformed ciphertext/);
  });
});
