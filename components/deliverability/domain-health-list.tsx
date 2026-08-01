"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { GlobeIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";

import type { Tables } from "@/types/database.types";
import type { DnsCheckStatus, DnsRecordType } from "@/lib/deliverability/types";
import { deleteDomainAction, runDomainDnsCheckAction } from "@/app/(app)/settings/deliverability/actions";
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
import { ScoreBadge } from "./score-badge";
import { DomainForm } from "./domain-form";

type Domain = Tables<"domains">;
type DomainDnsCheck = Tables<"domain_dns_checks">;

const DNS_RECORD_TYPES: DnsRecordType[] = ["spf", "dkim", "dmarc", "mx"];

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  verified: "default",
  failed: "destructive",
};

const DNS_STATUS_VARIANT: Record<DnsCheckStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pass: "default",
  fail: "destructive",
  error: "destructive",
  pending: "outline",
};

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function lastCheckedLabel(lastCheckedAt: string | null) {
  return lastCheckedAt ? new Date(lastCheckedAt).toLocaleString() : "Never";
}

export function DomainHealthList({
  domains,
  latestChecksByDomain,
}: {
  domains: Domain[];
  latestChecksByDomain: Record<string, Partial<Record<DnsRecordType, DomainDnsCheck>>>;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [deleting, setDeleting] = useState<Domain | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();
  const [isChecking, startCheckTransition] = useTransition();

  function handleDelete() {
    if (!deleting) return;
    const target = deleting;
    startDeleteTransition(async () => {
      try {
        await deleteDomainAction(target.id);
        toast.success("Domain removed.");
        setDeleting(null);
      } catch {
        toast.error("Couldn't remove the domain. Try again.");
      }
    });
  }

  function handleCheck(domain: Domain) {
    setCheckingId(domain.id);
    startCheckTransition(async () => {
      try {
        await runDomainDnsCheckAction(domain.id);
        toast.success(`Checked ${domain.domain}.`);
      } catch {
        toast.error("Couldn't check this domain. Try again.");
      } finally {
        setCheckingId(null);
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>Domain health</CardTitle>
          <CardDescription>SPF, DKIM, DMARC, and MX status for every sending domain.</CardDescription>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <PlusIcon />
              Add domain
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add a sending domain</DialogTitle>
              <DialogDescription>Track DNS verification and health for a domain you send from.</DialogDescription>
            </DialogHeader>
            <DomainForm onSuccess={() => setAddOpen(false)} />
          </DialogContent>
        </Dialog>
      </CardHeader>

      <CardContent>
        {domains.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <GlobeIcon className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">No domains added yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Add a domain to start monitoring its deliverability.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {domains.map((domain) => {
              const checks = latestChecksByDomain[domain.id] ?? {};
              return (
                <li key={domain.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium">{domain.domain}</p>
                        <Badge variant={STATUS_VARIANT[domain.status] ?? "outline"}>
                          {statusLabel(domain.status)}
                        </Badge>
                        <ScoreBadge score={domain.health_score} />
                      </div>
                      <p className="truncate text-sm text-muted-foreground">
                        Last checked: {lastCheckedLabel(domain.last_checked_at)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Check ${domain.domain} now`}
                        disabled={isChecking && checkingId === domain.id}
                        onClick={() => handleCheck(domain)}
                      >
                        <RefreshCwIcon className={checkingId === domain.id && isChecking ? "size-4 animate-spin" : "size-4"} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${domain.domain}`}
                        onClick={() => setDeleting(domain)}
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {DNS_RECORD_TYPES.map((recordType) => {
                      const check = checks[recordType];
                      const status = (check?.status ?? "pending") as DnsCheckStatus;
                      return (
                        <Badge
                          key={recordType}
                          variant={DNS_STATUS_VARIANT[status]}
                          title={check?.detail ?? "Not checked yet."}
                        >
                          {recordType.toUpperCase()}
                        </Badge>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove domain?</DialogTitle>
            <DialogDescription>
              This removes {deleting?.domain} and its DNS check history. Mailboxes linked to it will need a new
              domain.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? "Removing…" : "Remove domain"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
