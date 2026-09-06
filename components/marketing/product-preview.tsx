import { BarChart3Icon, LayoutDashboardIcon, MailIcon, MegaphoneIcon, UsersIcon } from "lucide-react";

// Sample data for an illustrative product preview only — never fetched,
// never real. Shapes mirror the real dashboard (see
// app/(app)/dashboard/page.tsx and components/dashboard/stat-card.tsx)
// without embedding an authenticated component here.
const STATS = [
  { label: "Total leads", value: "1,248", icon: UsersIcon },
  { label: "Mailboxes", value: "4", icon: MailIcon },
  { label: "Emails sent", value: "3,502", icon: MegaphoneIcon },
  { label: "Replies", value: "86", icon: BarChart3Icon },
];

const ACTIVITY_BARS = [35, 52, 40, 68, 58, 74, 62, 80, 70, 90, 76, 84];

const RECENT_ACTIVITY = [
  "Sent to jane@acme.co",
  "Reply from m.owen@initech.co",
  "Sequence step 2 sent",
  "Reply from d.lang@globex.co",
];

export function ProductPreview() {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-14 right-4 size-64 rounded-full bg-primary/20 blur-3xl sm:size-72"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-16 left-4 size-56 rounded-full bg-primary/10 blur-3xl"
      />

      <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-primary/5">
        <div className="flex">
          <div className="hidden w-14 shrink-0 flex-col items-center gap-5 border-r border-sidebar-border bg-sidebar py-5 sm:flex">
            <span className="flex size-8 items-center justify-center rounded-md bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground">
              P
            </span>
            <LayoutDashboardIcon className="size-4 text-primary" aria-hidden />
            <UsersIcon className="size-4 text-sidebar-foreground/40" aria-hidden />
            <MegaphoneIcon className="size-4 text-sidebar-foreground/40" aria-hidden />
            <MailIcon className="size-4 text-sidebar-foreground/40" aria-hidden />
            <BarChart3Icon className="size-4 text-sidebar-foreground/40" aria-hidden />
          </div>

          <div className="flex-1 p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Dashboard</p>
                <p className="text-sm font-semibold">Welcome back</p>
              </div>
              <span className="rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
                3 campaigns active
              </span>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {STATS.map((stat) => (
                <div key={stat.label} className="rounded-lg border border-border bg-background p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-muted-foreground">{stat.label}</span>
                    <stat.icon className="size-3.5 text-primary" aria-hidden />
                  </div>
                  <p className="mt-1.5 text-lg font-semibold tabular-nums">{stat.value}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-5">
              <div className="rounded-lg border border-border bg-background p-4 lg:col-span-3">
                <p className="text-xs font-medium text-muted-foreground">Sending activity</p>
                <div className="mt-3 flex h-16 items-end gap-1">
                  {ACTIVITY_BARS.map((height, index) => (
                    <div
                      key={index}
                      className="min-h-[2px] flex-1 rounded-t-sm bg-primary/30"
                      style={{ height: `${height}%` }}
                    />
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-background p-4 lg:col-span-2">
                <p className="text-xs font-medium text-muted-foreground">Recent activity</p>
                <ul className="mt-2.5 space-y-2 text-xs text-muted-foreground">
                  {RECENT_ACTIVITY.map((item) => (
                    <li key={item} className="flex items-center gap-2">
                      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success" />
                      <span className="truncate">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">Illustrative preview using sample data.</p>
    </div>
  );
}
