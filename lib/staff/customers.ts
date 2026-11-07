import type { User } from "@supabase/supabase-js";

import type { Tables } from "@/types/database.types";
import type { Client } from "@/lib/db/shared";
import { getPlan, type PlanId } from "@/lib/billing/plans";
import { isInternalUnlimitedOrganization } from "@/lib/billing/resolve-plan";
import { resolveSubscriptionView, type SubscriptionView } from "@/lib/billing/subscription-view";
import { isStaffUser } from "./directory";

// The console's customer directory: every organization with its owner, the
// plan it actually resolves to (the same precedence rules billing uses —
// resolveSubscriptionView), and this month's verified-lead delivery.
// Service-role client only. Built from a few bulk reads, never a query per
// organization.

export interface CustomerRow {
  organizationId: string;
  name: string;
  ownerUserId: string;
  ownerEmail: string | null;
  ownerIsStaff: boolean;
  createdAt: string;
  internal: boolean;
  planId: PlanId;
  planName: string;
  subscription: SubscriptionView;
  verifiedLeads: { delivered: number; quota: number } | null;
}

export interface CustomerInputs {
  organizations: readonly Pick<Tables<"organizations">, "id" | "name" | "owner_user_id" | "created_at">[];
  legacySubscriptions: readonly Tables<"subscriptions">[];
  subscriptionsV2: readonly Tables<"subscriptions_v2">[];
  allocations: readonly Pick<Tables<"verified_lead_allocations">, "organization_id" | "delivered_count" | "quota">[];
  users: readonly Pick<User, "id" | "email" | "app_metadata">[];
}

export function buildCustomerRows(inputs: CustomerInputs, now: Date = new Date()): CustomerRow[] {
  const legacyByOrg = new Map(inputs.legacySubscriptions.map((row) => [row.organization_id, row]));
  const v2ByOrg = new Map(inputs.subscriptionsV2.map((row) => [row.organization_id, row]));
  const allocationByOrg = new Map(inputs.allocations.map((row) => [row.organization_id, row]));
  const userById = new Map(inputs.users.map((user) => [user.id, user]));

  return inputs.organizations.map((organization) => {
    const internal = isInternalUnlimitedOrganization(organization.id);
    const subscription = resolveSubscriptionView(
      organization.id,
      legacyByOrg.get(organization.id) ?? null,
      v2ByOrg.get(organization.id) ?? null,
      now,
    );
    const planId = subscription.grantsAccess ? subscription.planId : "free";
    const owner = userById.get(organization.owner_user_id);
    const allocation = allocationByOrg.get(organization.id);
    return {
      organizationId: organization.id,
      name: organization.name,
      ownerUserId: organization.owner_user_id,
      ownerEmail: owner?.email ?? null,
      ownerIsStaff: owner ? isStaffUser(owner) : false,
      createdAt: organization.created_at,
      internal,
      planId,
      planName: internal ? "Internal (unlimited)" : getPlan(planId).name,
      subscription,
      verifiedLeads: allocation ? { delivered: allocation.delivered_count, quota: allocation.quota } : null,
    };
  });
}

// Paying = a subscription that currently grants a paid plan. Polimatiq's own
// internal workspace is never counted.
export function isPayingCustomer(row: Pick<CustomerRow, "internal" | "subscription">): boolean {
  return !row.internal && row.subscription.grantsAccess;
}

export function countCustomersByPlan(rows: readonly CustomerRow[]): Record<PlanId, number> {
  const counts: Record<PlanId, number> = { free: 0, starter: 0, growth: 0, pro: 0, scale: 0 };
  for (const row of rows) {
    if (!row.internal) counts[isPayingCustomer(row) ? row.planId : "free"] += 1;
  }
  return counts;
}

const PAGE = 1000;

async function readAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

export async function loadCustomerInputs(
  supabase: Client,
  period: string,
  users: CustomerInputs["users"],
): Promise<CustomerInputs> {
  const [organizations, legacySubscriptions, subscriptionsV2, allocations] = await Promise.all([
    readAllPages((from, to) =>
      supabase.from("organizations").select("id, name, owner_user_id, created_at").order("created_at", { ascending: false }).range(from, to),
    ),
    readAllPages((from, to) => supabase.from("subscriptions").select("*").order("id").range(from, to)),
    readAllPages((from, to) => supabase.from("subscriptions_v2").select("*").order("id").range(from, to)),
    readAllPages((from, to) =>
      supabase.from("verified_lead_allocations").select("organization_id, delivered_count, quota").eq("period", period).order("id").range(from, to),
    ),
  ]);
  return { organizations, legacySubscriptions, subscriptionsV2, allocations, users };
}
