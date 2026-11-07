import type { GrcControlUpdateInput } from "@/lib/validations/staff";

export type GrcStatus = GrcControlUpdateInput["status"];

export const GRC_STATUS_LABELS: Record<GrcStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  done: "Done",
  not_applicable: "Not applicable",
};

export function isGrcStatus(value: string): value is GrcStatus {
  return value in GRC_STATUS_LABELS;
}
