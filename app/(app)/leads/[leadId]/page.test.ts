import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// This page is a Server Component: every prop it passes to a Client
// Component is serialized into the RSC payload, and a function can't be
// (only Server Functions can). Passing one fails the server render — in
// production the "Lead details" widget showed only React's opaque error
// #441 ("Event handlers cannot be passed to Client Component props" on the
// server), so the lead could not be edited from this page.
const db = vi.hoisted(() => ({
  getLead: vi.fn(),
  listCampaignLeadsForLead: vi.fn(),
  listCampaigns: vi.fn(),
  listEmailEvents: vi.fn(),
  listLeadLists: vi.fn(),
  listLeadNotes: vi.fn(),
  listMailboxes: vi.fn(),
  listSendAttemptsForCampaignLeads: vi.fn(),
  listSequenceSteps: vi.fn(),
  listSequences: vi.fn(),
}));
vi.mock("@/lib/db", () => db);
vi.mock("@/lib/supabase/auth", () => ({ getUser: async () => ({ id: "user-1" }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ __fakeClient: true }) }));

import LeadDetailPage from "./page";
import { LeadForm } from "@/components/leads/lead-form";
import { LeadNotes } from "@/components/leads/lead-notes";
import { LeadStatusSelect } from "@/components/leads/lead-status-select";

const LEAD = {
  id: "lead-1",
  user_id: "user-1",
  email: "jane@example.com",
  first_name: "Jane",
  last_name: "Cooper",
  company: null,
  title: null,
  status: "new",
  verification_status: "unverified",
  list_id: null,
  timezone: null,
};

// Every element in the page's returned tree, without rendering it.
function collectElements(node: ReactNode, out: ReactElement<Record<string, unknown>>[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, out);
  } else if (isValidElement<Record<string, unknown>>(node)) {
    out.push(node);
    collectElements(node.props.children as ReactNode, out);
  }
  return out;
}

function componentName(type: unknown) {
  if (typeof type === "string") return type;
  if (typeof type === "function") return type.name || "(anonymous)";
  return String(type);
}

async function renderPage() {
  return (await LeadDetailPage({ params: Promise.resolve({ leadId: "lead-1" }) })) as ReactNode;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.getLead.mockResolvedValue(LEAD);
  db.listCampaignLeadsForLead.mockResolvedValue([]);
  db.listCampaigns.mockResolvedValue([]);
  db.listEmailEvents.mockResolvedValue([]);
  db.listLeadLists.mockResolvedValue([{ id: "list-1", name: "List 1" }]);
  db.listMailboxes.mockResolvedValue([]);
  db.listLeadNotes.mockResolvedValue([{ id: "note-1", body: "Wants a demo" }]);
  db.listSendAttemptsForCampaignLeads.mockResolvedValue([]);
  db.listSequences.mockResolvedValue([]);
  db.listSequenceSteps.mockResolvedValue([]);
});

describe("lead detail page (Server Component)", () => {
  it("renders the edit form for the lead", async () => {
    const forms = collectElements(await renderPage()).filter((element) => element.type === LeadForm);

    expect(forms).toHaveLength(1);
    expect(forms[0].props).toMatchObject({ mode: "edit", lead: LEAD, leadLists: [{ id: "list-1", name: "List 1" }] });
  });

  it("renders the lead's notes and its status picker", async () => {
    const elements = collectElements(await renderPage());

    expect(elements.find((element) => element.type === LeadNotes)?.props).toMatchObject({
      leadId: "lead-1",
      notes: [{ id: "note-1", body: "Wants a demo" }],
    });
    expect(elements.find((element) => element.type === LeadStatusSelect)?.props).toEqual({ leadId: "lead-1", status: "new" });
  });

  it("passes no function props to any component", async () => {
    const functionProps = collectElements(await renderPage()).flatMap((element) =>
      Object.entries(element.props)
        .filter(([, value]) => typeof value === "function")
        .map(([prop]) => `<${componentName(element.type)} ${prop}>`),
    );

    expect(functionProps).toEqual([]);
  });
});
