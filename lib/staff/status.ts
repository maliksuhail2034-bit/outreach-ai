// Display labels for staff account status. Kept outside any "use client"
// module so Server Components get the values, not client references.
export const STAFF_STATUS_LABELS = { active: "Active", invited: "Invited", disabled: "Blocked", archived: "Archived" } as const;
export const STAFF_STATUS_VARIANT = { active: "default", invited: "secondary", disabled: "destructive", archived: "outline" } as const;
export type StaffStatusName = keyof typeof STAFF_STATUS_LABELS;
