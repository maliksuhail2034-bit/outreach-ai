"use client";

import Link from "next/link";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { CheckIcon, ChevronRightIcon, CircleIcon, PartyPopperIcon } from "lucide-react";

export type ChecklistItem = {
  id: string;
  label: string;
  done: boolean;
  href?: string;
  /** Shown in a toast when the step has no destination yet (no `href`). */
  toastMessage?: string;
};

export function SetupChecklist({ items }: { items: ChecklistItem[] }) {
  const total = items.length;
  const completed = items.filter((item) => item.done).length;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  const isComplete = completed === total;

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold tracking-tight">Setup checklist</h2>
          <p className="text-sm text-muted-foreground">
            {isComplete ? "You're all set up." : `${completed} of ${total} steps complete`}
          </p>
        </div>
        {isComplete ? (
          <PartyPopperIcon className="size-5 shrink-0 text-primary" aria-hidden />
        ) : (
          <span className="shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">{percent}%</span>
        )}
      </div>

      <div
        className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Setup progress"
      >
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary"
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>

      <ul className="mt-6 space-y-1.5">
        {items.map((item, index) => {
          const node = item.done ? (
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <CheckIcon className="size-3" />
            </span>
          ) : (
            <CircleIcon className="size-5 shrink-0 text-muted-foreground/40" />
          );

          const label = (
            <span className={item.done ? "flex-1 text-muted-foreground" : "flex-1 font-medium text-foreground"}>
              {item.label}
            </span>
          );

          const chevron = !item.done && (
            <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5" />
          );

          const content = (
            <>
              {node}
              {label}
              {chevron}
            </>
          );

          const doneRowClassName = "flex items-center gap-3 rounded-md px-2.5 py-2.5 text-sm";
          const actionableRowClassName =
            "group flex w-full items-center gap-3 rounded-md px-2.5 py-2.5 text-left text-sm transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

          return (
            <motion.li
              key={item.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
            >
              {item.done ? (
                <div className={doneRowClassName}>{content}</div>
              ) : item.href ? (
                <Link href={item.href} className={actionableRowClassName}>
                  {content}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => toast.info(item.toastMessage ?? `${item.label} — coming soon.`)}
                  className={actionableRowClassName}
                >
                  {content}
                </button>
              )}
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}
