"use client";

import Link from "next/link";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { ImportIcon, MailPlusIcon, MegaphoneIcon, WorkflowIcon, type LucideIcon } from "lucide-react";

type QuickAction = {
  title: string;
  description: string;
  icon: LucideIcon;
  /** Real, working destination. Omit for features not built yet — see
   *  CLAUDE.md: don't link to routes that don't exist. Those preview the
   *  upcoming action via toast instead of navigating anywhere. */
  href?: string;
};

const actions: QuickAction[] = [
  {
    title: "Import leads",
    description: "Upload a CSV or connect a source to build your first list.",
    icon: ImportIcon,
    href: "/leads",
  },
  {
    title: "Connect mailbox",
    description: "Link a sending mailbox and start warming it up.",
    icon: MailPlusIcon,
    href: "/mailboxes",
  },
  {
    title: "Create campaign",
    description: "Group leads and mailboxes into an outbound campaign.",
    icon: MegaphoneIcon,
  },
  {
    title: "Build sequence",
    description: "Write the steps and timing for your outreach.",
    icon: WorkflowIcon,
  },
];

const MotionLink = motion.create(Link);

const cardClassName =
  "group relative flex cursor-pointer flex-col items-start gap-3 overflow-hidden rounded-xl border border-border bg-gradient-to-br from-card to-muted/40 p-5 text-left shadow-sm outline-none transition-[box-shadow,border-color] duration-150 hover:border-primary/30 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function QuickActions() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {actions.map((action, index) => {
        const content = (
          <>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform duration-150 group-hover:scale-110">
              <action.icon className="size-5" />
            </span>
            <div>
              <p className="font-medium">{action.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{action.description}</p>
            </div>
            {!action.href && (
              <span className="text-xs font-medium text-primary opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                Coming soon →
              </span>
            )}
          </>
        );

        if (action.href) {
          return (
            <MotionLink
              key={action.title}
              href={action.href}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
              whileHover={{ y: -4, transition: { duration: 0.15, ease: "easeOut" } }}
              whileTap={{ y: -1, transition: { duration: 0.1 } }}
              className={cardClassName}
            >
              {content}
            </MotionLink>
          );
        }

        return (
          <motion.button
            key={action.title}
            type="button"
            onClick={() => toast.info(`${action.title} is coming soon.`)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.05 }}
            whileHover={{ y: -4, transition: { duration: 0.15, ease: "easeOut" } }}
            whileTap={{ y: -1, transition: { duration: 0.1 } }}
            className={cardClassName}
          >
            {content}
          </motion.button>
        );
      })}
    </div>
  );
}
