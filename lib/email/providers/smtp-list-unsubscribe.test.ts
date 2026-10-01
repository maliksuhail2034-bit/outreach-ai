import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tables } from "@/types/database.types";
import type { OutboundEmailMessage } from "../provider";

// The real nodemailer message builder, with only the network swapped out: a
// stream transport renders the exact MIME message an SMTP send would
// transmit, so these assertions are about the headers actually on the wire,
// not about the options object handed to sendMail.
const sent = vi.hoisted(() => ({ messages: [] as string[] }));
vi.mock("nodemailer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("nodemailer")>();
  const createTransport = () => {
    const transport = actual.createTransport({ streamTransport: true, buffer: true, newline: "\r\n" });
    return {
      sendMail: async (mail: Parameters<typeof transport.sendMail>[0]) => {
        const info = await transport.sendMail(mail);
        sent.messages.push((info.message as unknown as Buffer).toString("utf8"));
        return info;
      },
    };
  };
  // smtp.ts uses the default import (nodemailer.createTransport).
  return { ...actual, default: { ...actual, createTransport }, createTransport };
});
vi.mock("@/lib/crypto/smtp-secret", () => ({ decryptSmtpPassword: () => "decrypted-password" }));

import { SmtpEmailProvider } from "./smtp";

const MAILBOX = {
  id: "mailbox-1",
  email: "sender@example.test",
  email_provider: "smtp",
  smtp_host: "smtp.example.test",
  smtp_port: 587,
  smtp_username: "sender@example.test",
  encrypted_smtp_password: "enc",
} as Tables<"mailboxes">;

const ONE_CLICK_URL = "https://app.example.test/unsubscribe/v2.dG9rZW4tZm9yLWEtcmVjaXBpZW50/one-click";

const MESSAGE: OutboundEmailMessage = {
  from: { email: "sender@example.test" },
  to: { email: "lead@example.test" },
  subject: "Hi",
  html: "<p>Hi</p>",
  text: "Hi",
};

// Header section of the rendered message, unfolded (RFC 5322 §2.2.3), as a
// receiving server reads it.
async function sentHeaders(message: OutboundEmailMessage): Promise<Map<string, string[]>> {
  await new SmtpEmailProvider(MAILBOX).send(message);
  const raw = sent.messages.at(-1)!;
  const headerSection = raw.split("\r\n\r\n")[0].replace(/\r\n[ \t]+/g, " ");
  const headers = new Map<string, string[]>();
  for (const line of headerSection.split("\r\n")) {
    const colon = line.indexOf(":");
    const name = line.slice(0, colon).toLowerCase();
    headers.set(name, [...(headers.get(name) ?? []), line.slice(colon + 1).trim()]);
  }
  return headers;
}

beforeEach(() => {
  sent.messages.length = 0;
});

describe("SmtpEmailProvider — List-Unsubscribe headers", () => {
  it("adds List-Unsubscribe with the one-click URL in angle brackets, once", async () => {
    const headers = await sentHeaders({ ...MESSAGE, listUnsubscribeUrl: ONE_CLICK_URL });

    expect(headers.get("list-unsubscribe")).toEqual([`<${ONE_CLICK_URL}>`]);
  });

  it("adds List-Unsubscribe-Post: List-Unsubscribe=One-Click, once", async () => {
    const headers = await sentHeaders({ ...MESSAGE, listUnsubscribeUrl: ONE_CLICK_URL });

    expect(headers.get("list-unsubscribe-post")).toEqual(["List-Unsubscribe=One-Click"]);
  });

  it("keeps a full-length v2 token URL intact on the wire", async () => {
    const longUrl = `https://app.example.test/unsubscribe/v2.${"A".repeat(240)}/one-click`;
    const headers = await sentHeaders({ ...MESSAGE, listUnsubscribeUrl: longUrl });

    expect(headers.get("list-unsubscribe")).toEqual([`<${longUrl}>`]);
  });

  it("adds no unsubscribe headers to a message without a listUnsubscribeUrl (warmup and any non-campaign send)", async () => {
    const headers = await sentHeaders(MESSAGE);

    expect(headers.has("list-unsubscribe")).toBe(false);
    expect(headers.has("list-unsubscribe-post")).toBe(false);
  });
});
