"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  BadgeCheckIcon,
  FolderInputIcon,
  GlobeIcon,
  MailOpenIcon,
  MegaphoneIcon,
  MousePointerClickIcon,
  PencilIcon,
  ReplyIcon,
  SendIcon,
  TagIcon,
  Trash2Icon,
  UserPlusIcon,
} from "lucide-react";

import type { Tables } from "@/types/database.types";
import {
  deleteAllLeadsAction,
  deleteLeadAction,
  deleteLeadsAction,
  moveLeadsToListAction,
  queueLeadsVerificationAction,
  setLeadsStatusAction,
  setLeadsTimezoneAction,
  verifyLeadAction,
} from "@/app/(app)/leads/actions";
import { enrollLeadsAction } from "@/app/(app)/campaigns/[campaignId]/actions";
import { ActionError, unwrapActionResult } from "@/lib/action-result";
import type { CrmLead } from "@/lib/db/crm-leads";
import { formatRelativeTime } from "@/lib/inbox/format";
import {
  LEAD_STATUS_VARIANT,
  isVerifiedPoolLead,
  leadEmailLabel,
  leadStatusLabel,
} from "@/lib/leads/display";
import { LEAD_STATUSES } from "@/lib/validations/leads";
import { crmLeadsHref, type BulkLeadTarget, type CrmSearchParams } from "@/lib/validations/crm-leads";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Pagination } from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TimezoneSelect } from "@/components/campaigns/timezone-select";
import { CsvImportDialog } from "./csv-import-dialog";
import { LeadForm } from "./lead-form";
import { VERIFICATION_LABEL, type CampaignOption } from "./crm-lead-filters";

type LeadList = Tables<"lead_lists">;

const VERIFICATION_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "success" | "outline"> = {
  unverified: "outline",
  pending: "secondary",
  valid: "success",
  invalid: "destructive",
  catch_all: "secondary",
  unknown: "secondary",
  error: "destructive",
};

// The refusal enrollLeadRows returns when some leads are suppressed; the
// dialog then offers "Enroll anyway" (same as components/campaigns/enroll-dialog.tsx).
const SUPPRESSION_REFUSAL = /suppressed \(bounced\/unsubscribed\)\. Confirm to enroll anyway\.$/;

// Radix Select can't hold "" as a value.
const NO_LIST = "none";

type BulkDialog = "move" | "status" | "enroll" | "timezone" | "delete" | null;

function leadName(lead: Tables<"leads">) {
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ");
  return name || leadEmailLabel(lead);
}

function plural(count: number, word = "lead") {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function errorText(error: unknown, fallback: string) {
  return error instanceof ActionError ? error.message : fallback;
}

// One engagement count: icon plus number, muted at zero, with the meaning
// spelled out for screen readers and on hover.
function EngagementCount({ icon: Icon, count, label }: { icon: typeof SendIcon; count: number; label: string }) {
  return (
    <span
      title={`${count} ${label}`}
      className={`inline-flex items-center gap-1 tabular-nums ${count > 0 ? "text-foreground" : "text-muted-foreground/60"}`}
    >
      <Icon aria-hidden className="size-3.5" />
      {count}
      <span className="sr-only"> {label}</span>
    </span>
  );
}

export function LeadTable({
  leads,
  leadLists,
  campaigns,
  params,
  leadCount,
  accountLeadCount,
  page,
  pageSize,
  now,
}: {
  leads: CrmLead[];
  leadLists: LeadList[];
  // Campaigns the selected leads can be enrolled in.
  campaigns: CampaignOption[];
  params: CrmSearchParams;
  // Leads matching the current filters (what the table and pagination show).
  leadCount: number;
  // Every lead in the account, whatever is filtered — what "Delete all" deletes.
  accountLeadCount: number;
  page: number;
  pageSize: number;
  // The server's clock, so relative times render the same on server and client.
  now: string;
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<CrmLead | null>(null);
  const [deleting, setDeleting] = useState<CrmLead | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [isDeletingAll, startDeleteAllTransition] = useTransition();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Every lead matching the filters, not just the ticked rows on this page.
  const [allMatching, setAllMatching] = useState(false);
  const [bulkDialog, setBulkDialog] = useState<BulkDialog>(null);
  const [isBulkPending, startBulkTransition] = useTransition();
  const [bulkListId, setBulkListId] = useState(NO_LIST);
  const [bulkStatus, setBulkStatus] = useState<string>("interested");
  const [bulkTimezone, setBulkTimezone] = useState("");
  const [enrollCampaignId, setEnrollCampaignId] = useState("");
  const [suppressionMessage, setSuppressionMessage] = useState<string | null>(null);
  const [confirmSuppressed, setConfirmSuppressed] = useState(false);

  const [verifyingIds, setVerifyingIds] = useState<Set<string>>(new Set());
  const [isQueuingVerification, startQueueVerificationTransition] = useTransition();

  const nowDate = new Date(now);
  const listNameById = new Map(leadLists.map((list) => [list.id, list.name]));
  const enrollableCampaigns = campaigns.filter((campaign) => campaign.status !== "completed");

  // Drops ids from a previous render's leads (e.g. one just deleted) so the
  // count never shows stale selections.
  const visibleIds = new Set(leads.map((lead) => lead.id));
  const selectedIds = [...selected].filter((id) => visibleIds.has(id));
  const allSelected = leads.length > 0 && selectedIds.length === leads.length;
  const targetCount = allMatching ? leadCount : selectedIds.length;
  const hasMorePages = leadCount > leads.length;

  // The page's filters without the page number: what "all matching" means.
  const filterQuery = crmLeadsHref({ ...params, page: 1 }).replace(/^\/leads\??/, "");
  const bulkTarget: BulkLeadTarget = allMatching ? { query: filterQuery } : { ids: selectedIds };

  function clearSelection() {
    setSelected(new Set());
    setAllMatching(false);
  }

  function toggleAll() {
    if (allSelected) clearSelection();
    else setSelected(new Set(visibleIds));
  }

  function toggleOne(id: string) {
    setAllMatching(false);
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openBulk(dialog: BulkDialog) {
    setSuppressionMessage(null);
    setConfirmSuppressed(false);
    setBulkDialog(dialog);
  }

  function finishBulk(message: string) {
    toast.success(message);
    clearSelection();
    setBulkDialog(null);
  }

  function handleMove() {
    startBulkTransition(async () => {
      try {
        const listId = bulkListId === NO_LIST ? "" : bulkListId;
        const { count } = unwrapActionResult(await moveLeadsToListAction({ target: bulkTarget, listId }));
        const listName = listId ? (listNameById.get(listId) ?? "the list") : null;
        finishBulk(listName ? `Moved ${plural(count)} to ${listName}.` : `Took ${plural(count)} out of their list.`);
      } catch (error) {
        toast.error(errorText(error, "Couldn't move the leads. Try again."));
      }
    });
  }

  function handleSetStatus() {
    startBulkTransition(async () => {
      try {
        const { count } = unwrapActionResult(await setLeadsStatusAction({ target: bulkTarget, status: bulkStatus }));
        finishBulk(`Set ${plural(count)} to ${leadStatusLabel(bulkStatus)}.`);
      } catch (error) {
        toast.error(errorText(error, "Couldn't change the status. Try again."));
      }
    });
  }

  function handleEnroll() {
    if (!enrollCampaignId) return;
    startBulkTransition(async () => {
      try {
        const result = await enrollLeadsAction(enrollCampaignId, bulkTarget, undefined, confirmSuppressed);
        if (!result.ok && SUPPRESSION_REFUSAL.test(result.error)) {
          setSuppressionMessage(result.error.replace("Confirm to enroll anyway.", "They won't get emails unless you mean to send to them."));
          return;
        }
        const { inserted, skipped } = unwrapActionResult(result);
        const campaignName = campaigns.find((campaign) => campaign.id === enrollCampaignId)?.name ?? "the campaign";
        finishBulk(
          `Enrolled ${plural(inserted)} in ${campaignName}.${skipped > 0 ? ` ${plural(skipped)} already there were skipped.` : ""}`,
        );
      } catch (error) {
        toast.error(errorText(error, "Couldn't enroll the leads. Try again."));
      }
    });
  }

  // Timezone and verification act on ticked leads only.
  function handleSetTimezone() {
    const ids = selectedIds;
    if (ids.length === 0) return;
    const timezone = bulkTimezone || null;
    startBulkTransition(async () => {
      try {
        await setLeadsTimezoneAction({ ids, timezone });
        finishBulk(timezone ? `Set ${plural(ids.length)} to ${timezone}.` : `${plural(ids.length)} now use the campaign timezone.`);
      } catch {
        toast.error("Couldn't update the selected leads' timezone. Try again.");
      }
    });
  }

  function handleBulkDelete() {
    const ids = selectedIds;
    if (ids.length === 0) return;
    startBulkTransition(async () => {
      try {
        await deleteLeadsAction(ids);
        finishBulk(`${plural(ids.length)} removed.`);
      } catch {
        toast.error("Couldn't remove the selected leads. Try again.");
      }
    });
  }

  // Never verifies inline — this only queues the leads for the verify-leads
  // cron worker (bulk verification is always queued).
  function handleQueueVerification() {
    const ids = selectedIds;
    if (ids.length === 0) return;
    startQueueVerificationTransition(async () => {
      try {
        await queueLeadsVerificationAction(ids);
        toast.success(`${plural(ids.length)} queued for verification.`);
        clearSelection();
      } catch {
        toast.error("Couldn't queue the selected leads for verification. Try again.");
      }
    });
  }

  function handleDelete() {
    if (!deleting) return;
    const target = deleting;
    startDeleteTransition(async () => {
      try {
        await deleteLeadAction(target.id);
        toast.success("Lead removed.");
        setDeleting(null);
      } catch {
        toast.error("Couldn't remove the lead. Try again.");
      }
    });
  }

  function handleDeleteAll() {
    startDeleteAllTransition(async () => {
      try {
        await deleteAllLeadsAction();
        toast.success("All leads removed.");
        clearSelection();
        setDeleteAllOpen(false);
      } catch {
        toast.error("Couldn't remove your leads. Try again.");
      }
    });
  }

  // Synchronous, one lead at a time; tracked per id so verifying one lead
  // doesn't disable the button on every other row.
  function handleVerify(lead: CrmLead) {
    setVerifyingIds((previous) => new Set(previous).add(lead.id));
    (async () => {
      try {
        await verifyLeadAction(lead.id);
      } catch {
        toast.error(`Couldn't verify ${leadEmailLabel(lead)}. Connect a provider in Settings -> Verification and try again.`);
      } finally {
        setVerifyingIds((previous) => {
          const next = new Set(previous);
          next.delete(lead.id);
          return next;
        });
      }
    })();
  }

  const filtered = filterQuery !== "" && filterQuery !== `sort=${params.sort}`;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-4">
        <div>
          <CardTitle>
            {leadCount} lead{leadCount === 1 ? "" : "s"}
            {filtered ? " match" : ""}
          </CardTitle>
          <CardDescription>
            {hasMorePages
              ? `Showing ${(page - 1) * pageSize + 1}-${(page - 1) * pageSize + leads.length}. `
              : ""}
            Opens and clicks are people only: security scanners and link checkers are left out.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CsvImportDialog leadLists={leadLists} />
          <Button size="sm" variant="outline" disabled={accountLeadCount === 0} onClick={() => setDeleteAllOpen(true)}>
            <Trash2Icon />
            Delete all
          </Button>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <UserPlusIcon />
                Add lead
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add a lead</DialogTitle>
                <DialogDescription>Add a single prospect to your leads.</DialogDescription>
              </DialogHeader>
              <LeadForm mode="create" leadLists={leadLists} onSuccess={() => setAddOpen(false)} />
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>

      <CardContent>
        {leads.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            {filtered ? (
              <>
                <p className="text-sm font-medium">No leads match these filters</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  <Link href="/leads" className="underline underline-offset-4">
                    Clear all filters
                  </Link>
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">No leads yet</p>
                <p className="mt-1 text-sm text-muted-foreground">Add a lead or import a CSV to get started.</p>
              </>
            )}
          </div>
        ) : (
          <>
            {selectedIds.length > 0 && (
              <div className="mb-3 space-y-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    {allMatching ? `All ${plural(leadCount)} matching these filters selected` : `${selectedIds.length} selected`}
                    {allSelected && hasMorePages && !allMatching && (
                      <Button variant="link" size="sm" className="h-auto px-2" onClick={() => setAllMatching(true)}>
                        Select all {leadCount} matching
                      </Button>
                    )}
                  </p>
                  <Button variant="ghost" size="sm" onClick={clearSelection}>
                    Clear
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => openBulk("enroll")} disabled={enrollableCampaigns.length === 0}>
                    <MegaphoneIcon />
                    Add to campaign
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openBulk("move")}>
                    <FolderInputIcon />
                    Move to list
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openBulk("status")}>
                    <TagIcon />
                    Set status
                  </Button>
                  {!allMatching && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setBulkTimezone("");
                          openBulk("timezone");
                        }}
                      >
                        <GlobeIcon />
                        Set timezone
                      </Button>
                      <Button variant="outline" size="sm" disabled={isQueuingVerification} onClick={handleQueueVerification}>
                        <BadgeCheckIcon />
                        {isQueuingVerification ? "Queuing…" : "Queue verification"}
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => openBulk("delete")}>
                        <Trash2Icon />
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="relative overflow-x-auto" style={{ contain: "layout" }}>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="w-8 py-2 pr-2">
                      <input
                        type="checkbox"
                        className="size-4 rounded-sm border-input accent-primary"
                        checked={allSelected}
                        ref={(element) => {
                          if (element) element.indeterminate = selectedIds.length > 0 && !allSelected;
                        }}
                        onChange={toggleAll}
                        aria-label="Select all leads on this page"
                      />
                    </th>
                    <th className="py-2 pr-4 font-medium">Lead</th>
                    <th className="py-2 pr-4 font-medium">Company</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">Engagement</th>
                    <th className="py-2 pr-4 font-medium whitespace-nowrap">Last activity</th>
                    <th className="py-2 pr-4 font-medium">List</th>
                    <th className="py-2 pr-4 font-medium">Verification</th>
                    <th className="sticky right-0 bg-card py-2 pl-4 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {leads.map((lead) => (
                    <tr key={lead.id} className={selected.has(lead.id) || allMatching ? "bg-muted/30" : undefined}>
                      <td className="py-3 pr-2">
                        <input
                          type="checkbox"
                          className="size-4 rounded-sm border-input accent-primary"
                          checked={allMatching || selected.has(lead.id)}
                          onChange={() => toggleOne(lead.id)}
                          aria-label={`Select ${leadName(lead)}`}
                        />
                      </td>
                      <td className="max-w-56 py-3 pr-4">
                        <Link href={`/leads/${lead.id}`} className="block truncate font-medium hover:underline">
                          {leadName(lead)}
                        </Link>
                        <p className="truncate text-xs text-muted-foreground">{leadEmailLabel(lead)}</p>
                        {/* On phones the engagement column is off-screen, so it's repeated here. */}
                        <div className="mt-1 flex items-center gap-3 text-xs sm:hidden">
                          <EngagementCount icon={MailOpenIcon} count={lead.crm_opens} label="opens" />
                          <EngagementCount icon={MousePointerClickIcon} count={lead.crm_clicks} label="clicks" />
                          <EngagementCount icon={ReplyIcon} count={lead.crm_replies} label="replies" />
                          <Badge variant={LEAD_STATUS_VARIANT[lead.status] ?? "outline"}>{leadStatusLabel(lead.status)}</Badge>
                        </div>
                      </td>
                      <td className="max-w-48 py-3 pr-4">
                        <p className="truncate">{lead.company || "—"}</p>
                        {lead.title && <p className="truncate text-xs text-muted-foreground">{lead.title}</p>}
                      </td>
                      <td className="py-3 pr-4 whitespace-nowrap">
                        <Badge variant={LEAD_STATUS_VARIANT[lead.status] ?? "outline"}>{leadStatusLabel(lead.status)}</Badge>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-3 text-xs">
                          <EngagementCount icon={SendIcon} count={lead.crm_sent} label="emails sent" />
                          <EngagementCount icon={MailOpenIcon} count={lead.crm_opens} label="opens" />
                          <EngagementCount icon={MousePointerClickIcon} count={lead.crm_clicks} label="clicks" />
                          <EngagementCount icon={ReplyIcon} count={lead.crm_replies} label="replies" />
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-xs whitespace-nowrap text-muted-foreground">
                        {lead.crm_last_activity_at ? formatRelativeTime(lead.crm_last_activity_at, nowDate) : "—"}
                      </td>
                      <td className="max-w-36 truncate py-3 pr-4 text-muted-foreground">
                        {lead.list_id ? (listNameById.get(lead.list_id) ?? "—") : "—"}
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant={VERIFICATION_STATUS_VARIANT[lead.verification_status] ?? "outline"}>
                          {VERIFICATION_LABEL[lead.verification_status] ?? lead.verification_status}
                        </Badge>
                      </td>
                      {/* Pinned so the row actions stay visible while the table scrolls sideways. */}
                      <td className="sticky right-0 bg-card py-3 pl-4">
                        <div className="flex items-center justify-end gap-1">
                          {!isVerifiedPoolLead(lead) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Verify ${leadName(lead)}`}
                              disabled={verifyingIds.has(lead.id)}
                              onClick={() => handleVerify(lead)}
                            >
                              <BadgeCheckIcon className="size-4" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" aria-label={`Edit ${leadName(lead)}`} onClick={() => setEditing(lead)}>
                            <PencilIcon className="size-4" />
                          </Button>
                          <Button variant="ghost" size="icon" aria-label={`Remove ${leadName(lead)}`} onClick={() => setDeleting(lead)}>
                            <Trash2Icon className="size-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>

      {leadCount > pageSize && (
        <CardContent className="border-t border-border pt-4">
          <Pagination
            page={page}
            pageSize={pageSize}
            totalCount={leadCount}
            onPageChange={(nextPage) => {
              clearSelection();
              router.push(crmLeadsHref({ ...params, page: nextPage }));
            }}
          />
        </CardContent>
      )}

      <Dialog open={bulkDialog === "enroll"} onOpenChange={(open) => !open && setBulkDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add {plural(targetCount)} to a campaign</DialogTitle>
            <DialogDescription>
              They start at step 1 and get every step from one mailbox, within the daily sending limits. A running
              campaign starts sending to them in its next sending hours. Leads already in the campaign are skipped.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="bulk-enroll-campaign">Campaign</Label>
            <Select
              value={enrollCampaignId}
              onValueChange={(value) => {
                setEnrollCampaignId(value);
                setSuppressionMessage(null);
                setConfirmSuppressed(false);
              }}
            >
              <SelectTrigger id="bulk-enroll-campaign" className="w-full">
                <SelectValue placeholder="Choose a campaign" />
              </SelectTrigger>
              <SelectContent>
                {enrollableCampaigns.map((campaign) => (
                  <SelectItem key={campaign.id} value={campaign.id}>
                    {campaign.name} ({campaign.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {suppressionMessage && (
            <div role="alert" className="space-y-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
              <p>{suppressionMessage}</p>
              <label className="flex items-center gap-2 font-medium">
                <input
                  type="checkbox"
                  className="size-4 rounded-sm border-input accent-primary"
                  checked={confirmSuppressed}
                  onChange={(event) => setConfirmSuppressed(event.target.checked)}
                />
                Enroll anyway
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDialog(null)} disabled={isBulkPending}>
              Cancel
            </Button>
            <Button
              onClick={handleEnroll}
              disabled={isBulkPending || !enrollCampaignId || (suppressionMessage !== null && !confirmSuppressed)}
            >
              {isBulkPending ? "Enrolling…" : "Enroll"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDialog === "move"} onOpenChange={(open) => !open && setBulkDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move {plural(targetCount)} to a list</DialogTitle>
            <DialogDescription>A lead is in one list at a time, so this takes them out of their current list.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="bulk-move-list">List</Label>
            <Select value={bulkListId} onValueChange={setBulkListId}>
              <SelectTrigger id="bulk-move-list" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_LIST}>No list</SelectItem>
                {leadLists.map((list) => (
                  <SelectItem key={list.id} value={list.id}>
                    {list.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDialog(null)} disabled={isBulkPending}>
              Cancel
            </Button>
            <Button onClick={handleMove} disabled={isBulkPending}>
              {isBulkPending ? "Moving…" : "Move"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDialog === "status"} onOpenChange={(open) => !open && setBulkDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set the status of {plural(targetCount)}</DialogTitle>
            <DialogDescription>Where these leads are in your sales pipeline.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="bulk-status">Status</Label>
            <Select value={bulkStatus} onValueChange={setBulkStatus}>
              <SelectTrigger id="bulk-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAD_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {leadStatusLabel(status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDialog(null)} disabled={isBulkPending}>
              Cancel
            </Button>
            <Button onClick={handleSetStatus} disabled={isBulkPending}>
              {isBulkPending ? "Saving…" : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDialog === "timezone"} onOpenChange={(open) => !open && setBulkDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set timezone for {plural(selectedIds.length)}</DialogTitle>
            <DialogDescription>
              Campaigns send to these leads within their sending hours in this timezone. Choose &ldquo;Use campaign
              timezone&rdquo; to clear it.
            </DialogDescription>
          </DialogHeader>
          <TimezoneSelect value={bulkTimezone} onChange={setBulkTimezone} emptyLabel="Use campaign timezone" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDialog(null)} disabled={isBulkPending}>
              Cancel
            </Button>
            <Button onClick={handleSetTimezone} disabled={isBulkPending}>
              {isBulkPending ? "Saving…" : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDialog === "delete"} onOpenChange={(open) => !open && setBulkDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {plural(selectedIds.length)}?</DialogTitle>
            <DialogDescription>This removes the selected leads permanently.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDialog(null)} disabled={isBulkPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleBulkDelete} disabled={isBulkPending}>
              {isBulkPending ? "Removing…" : `Remove ${plural(selectedIds.length)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit lead</DialogTitle>
            <DialogDescription>Update this lead&apos;s details.</DialogDescription>
          </DialogHeader>
          {editing && <LeadForm mode="edit" lead={editing} leadLists={leadLists} onSuccess={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove lead?</DialogTitle>
            <DialogDescription>This removes {deleting ? leadEmailLabel(deleting) : ""} permanently.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? "Removing…" : "Remove lead"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteAllOpen} onOpenChange={setDeleteAllOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete all leads?</DialogTitle>
            <DialogDescription>
              This permanently deletes all {plural(accountLeadCount)} in your account, including any not shown on this
              page or hidden by a filter. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteAllOpen(false)} disabled={isDeletingAll}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteAll} disabled={isDeletingAll}>
              {isDeletingAll ? "Deleting…" : "Delete all leads"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
