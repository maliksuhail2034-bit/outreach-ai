import { PASSWORD_MAX_LENGTH, PASSWORD_RULES } from "@/lib/validations/auth";

// Staff password and username policy. Pure (no I/O): shared by the console's
// Server Functions (enforcement), the password forms (live checklist) and
// the console gate that sends a non-compliant account to /console/account.

export type StaffRoleName = "owner" | "security" | "sales";

// Bump when the policy tightens: every account below the current version is
// asked for a new password at its next console visit.
export const STAFF_PASSWORD_POLICY_VERSION = 1;

export interface PasswordRule {
  id: string;
  label: string;
  message: string;
  test: (value: string) => boolean;
}

const PRIVILEGED_MIN_LENGTH = 16;
const SALES_MIN_LENGTH = 12;

export function isPrivilegedRole(role: StaffRoleName): boolean {
  return role === "owner" || role === "security";
}

export function staffPasswordMinLength(role: StaffRoleName): number {
  return isPrivilegedRole(role) ? PRIVILEGED_MIN_LENGTH : SALES_MIN_LENGTH;
}

// The customer rules (lowercase, uppercase, number), with a longer minimum
// for every staff role, and a symbol required for owner and security.
export function staffPasswordRules(role: StaffRoleName): PasswordRule[] {
  const min = staffPasswordMinLength(role);
  const rules: PasswordRule[] = [
    { id: "length", label: `At least ${min} characters`, message: `Must be at least ${min} characters.`, test: (value) => value.length >= min },
    ...PASSWORD_RULES.filter((rule) => rule.id !== "length"),
  ];
  if (isPrivilegedRole(role)) {
    rules.push({
      id: "symbol",
      label: "One symbol (e.g. ! @ # $ %)",
      message: "Include a symbol.",
      test: (value) => /[^A-Za-z0-9]/.test(value),
    });
  }
  return rules;
}

export function staffPasswordProblems(role: StaffRoleName, password: string, context: { username?: string; email?: string } = {}): string[] {
  const problems = staffPasswordRules(role)
    .filter((rule) => !rule.test(password))
    .map((rule) => rule.message);
  if (password.length > PASSWORD_MAX_LENGTH) problems.push(`Must be at most ${PASSWORD_MAX_LENGTH} characters.`);
  const lower = password.toLowerCase();
  const local = context.email?.split("@")[0]?.toLowerCase();
  if ((context.username && context.username.length >= 3 && lower.includes(context.username.toLowerCase())) || (local && local.length >= 3 && lower.includes(local))) {
    problems.push("Don't include your username or email in the password.");
  }
  if (/(.)\1{5,}/.test(password)) problems.push("Don't repeat the same character six or more times.");
  return problems;
}

// Whether the console must send this account to set a new password before
// anything else: an owner/security member asked them to, or an owner or
// security account whose password predates the current staff policy.
export function needsPasswordChange(staff: { role: string; password_must_change: boolean; password_policy_version: number }): boolean {
  if (staff.password_must_change) return true;
  return (staff.role === "owner" || staff.role === "security") && staff.password_policy_version < STAFF_PASSWORD_POLICY_VERSION;
}

// Usernames: 3-32 characters, lowercase letters, digits, dot, dash or
// underscore, starting with a letter or digit. Never an email address, so a
// leaked username doesn't reveal where the person receives mail.
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function usernameProblem(value: string): string | null {
  const username = normalizeUsername(value);
  if (username.includes("@")) return "A username can't be an email address.";
  if (!USERNAME_PATTERN.test(username)) {
    return "Use 3-32 characters: letters, numbers, dots, dashes or underscores, starting with a letter or number.";
  }
  return null;
}
