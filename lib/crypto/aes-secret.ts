import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// Generic AES-256-GCM string encryption, extracted out of smtp-secret.ts so
// every secret domain (SMTP/IMAP passwords, AI provider API keys, ...) can
// keep its own key material — and blast radius — without duplicating the
// cipher logic. Callers own key sourcing/validation; this module only ever
// sees the raw 32-byte key.
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;

export function parseEncryptionKey(envVarName: string, hexKey: string | undefined): Buffer {
  if (!hexKey) {
    throw new Error(
      `${envVarName} is not set. Generate one with \`openssl rand -hex 32\` and add it to .env.local — see .env.example.`,
    );
  }
  const keyBuffer = Buffer.from(hexKey, "hex");
  if (keyBuffer.length !== 32) {
    throw new Error(`${envVarName} must be a 64-character hex string (32 bytes) for AES-256-GCM.`);
  }
  return keyBuffer;
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, encrypted].map((part) => part.toString("base64")).join(":");
}

export function decryptSecret(ciphertext: string, key: Buffer): string {
  const [ivPart, authTagPart, dataPart] = ciphertext.split(":");
  if (!ivPart || !authTagPart || !dataPart) {
    throw new Error("Malformed ciphertext.");
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, "base64"));
  decipher.setAuthTag(Buffer.from(authTagPart, "base64"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataPart, "base64")), decipher.final()]);
  return decrypted.toString("utf8");
}
