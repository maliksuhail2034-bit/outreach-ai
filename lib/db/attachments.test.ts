import { describe, expect, it, vi } from "vitest";
import type { Client } from "./shared";
import {
  createAttachment,
  deleteAttachments,
  getAttachment,
  linkAttachmentsToStep,
  listAttachmentsForStep,
  listAttachmentsForStepScoped,
  listAttachmentsForSteps,
  listOwnedAttachmentsByIds,
} from "./attachments";

// Same fake-Client pattern as lib/db/campaign-leads.test.ts/suppressions.test.ts.
function createMockClient(result: { data?: unknown; error?: unknown }) {
  const chainable = {
    select: vi.fn(),
    delete: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    in: vi.fn(),
    single: vi.fn(),
    then: (resolve: (value: typeof result) => void) => resolve(result),
  };
  for (const method of ["select", "delete", "insert", "update", "eq", "order", "in", "single"] as const) {
    chainable[method].mockReturnValue(chainable);
  }

  const from = vi.fn(() => chainable);
  const client = { from } as unknown as Client;
  return { client, chainable };
}

const attachmentRow = {
  id: "attachment-1",
  user_id: "user-1",
  sequence_step_id: "step-1",
  file_name: "proposal.pdf",
  mime_type: "application/pdf",
  size_bytes: 1024,
  storage_path: "user-1/uuid-proposal.pdf",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("createAttachment", () => {
  it("inserts the given metadata and returns the created row", async () => {
    const { client, chainable } = createMockClient({ data: attachmentRow, error: null });

    const result = await createAttachment(client, {
      user_id: "user-1",
      sequence_step_id: null,
      file_name: "proposal.pdf",
      mime_type: "application/pdf",
      size_bytes: 1024,
      storage_path: "user-1/uuid-proposal.pdf",
    });

    expect(client.from).toHaveBeenCalledWith("email_attachments");
    expect(chainable.insert).toHaveBeenCalledWith(
      expect.objectContaining({ file_name: "proposal.pdf", mime_type: "application/pdf", size_bytes: 1024 }),
    );
    expect(result).toEqual(attachmentRow);
  });
});

describe("getAttachment", () => {
  it("scopes the read by both user_id and id — ownership, not just existence", async () => {
    const { client, chainable } = createMockClient({ data: attachmentRow, error: null });

    await getAttachment(client, "user-1", "attachment-1");

    expect(chainable.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(chainable.eq).toHaveBeenCalledWith("id", "attachment-1");
  });

  it("throws when no matching row is found for this user", async () => {
    const { client } = createMockClient({ data: null, error: null });
    await expect(getAttachment(client, "user-1", "attachment-1")).rejects.toThrow();
  });
});

describe("listAttachmentsForStep", () => {
  it("scopes by sequence_step_id only — relies on RLS for ownership", async () => {
    const { client, chainable } = createMockClient({ data: [attachmentRow], error: null });

    const result = await listAttachmentsForStep(client, "step-1");

    expect(chainable.eq).toHaveBeenCalledWith("sequence_step_id", "step-1");
    expect(result).toEqual([attachmentRow]);
  });
});

describe("listAttachmentsForStepScoped", () => {
  it("scopes by both sequence_step_id and user_id — the admin-client (send-worker) path has no RLS to fall back on", async () => {
    const { client, chainable } = createMockClient({ data: [attachmentRow], error: null });

    await listAttachmentsForStepScoped(client, "step-1", "user-1");

    expect(chainable.eq).toHaveBeenCalledWith("sequence_step_id", "step-1");
    expect(chainable.eq).toHaveBeenCalledWith("user_id", "user-1");
  });
});

describe("listAttachmentsForSteps", () => {
  it("queries by an array of step ids in one call (multiple attachments/steps)", async () => {
    const { client, chainable } = createMockClient({ data: [attachmentRow], error: null });

    await listAttachmentsForSteps(client, ["step-1", "step-2"]);

    expect(chainable.in).toHaveBeenCalledWith("sequence_step_id", ["step-1", "step-2"]);
  });

  it("returns an empty array without querying when given no ids", async () => {
    const { client } = createMockClient({ data: [attachmentRow], error: null });

    const result = await listAttachmentsForSteps(client, []);

    expect(result).toEqual([]);
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe("listOwnedAttachmentsByIds", () => {
  it("scopes by user_id and the requested id set", async () => {
    const { client, chainable } = createMockClient({ data: [attachmentRow], error: null });

    await listOwnedAttachmentsByIds(client, "user-1", ["attachment-1", "attachment-2"]);

    expect(chainable.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(chainable.in).toHaveBeenCalledWith("id", ["attachment-1", "attachment-2"]);
  });

  it("returns an empty array without querying when given no ids", async () => {
    const { client } = createMockClient({ data: [], error: null });

    const result = await listOwnedAttachmentsByIds(client, "user-1", []);

    expect(result).toEqual([]);
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe("linkAttachmentsToStep", () => {
  it("updates only the caller's own attachments among the given ids", async () => {
    const { client, chainable } = createMockClient({ error: null });

    await linkAttachmentsToStep(client, "user-1", ["attachment-1", "attachment-2"], "step-1");

    expect(chainable.update).toHaveBeenCalledWith({ sequence_step_id: "step-1" });
    expect(chainable.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(chainable.in).toHaveBeenCalledWith("id", ["attachment-1", "attachment-2"]);
  });

  it("does nothing when given no ids", async () => {
    const { client } = createMockClient({ error: null });

    await linkAttachmentsToStep(client, "user-1", [], "step-1");

    expect(client.from).not.toHaveBeenCalled();
  });
});

describe("deleteAttachments", () => {
  it("deletes only the caller's own attachments among the given ids", async () => {
    const { client, chainable } = createMockClient({ error: null });

    await deleteAttachments(client, "user-1", ["attachment-1", "attachment-2"]);

    expect(chainable.delete).toHaveBeenCalled();
    expect(chainable.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(chainable.in).toHaveBeenCalledWith("id", ["attachment-1", "attachment-2"]);
  });

  it("does nothing when given no ids", async () => {
    const { client } = createMockClient({ error: null });

    await deleteAttachments(client, "user-1", []);

    expect(client.from).not.toHaveBeenCalled();
  });

  it("throws when the delete errors", async () => {
    const { client } = createMockClient({ error: new Error("db down") });
    await expect(deleteAttachments(client, "user-1", ["attachment-1"])).rejects.toThrow("db down");
  });
});
