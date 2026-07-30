"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ImportIcon, MailPlusIcon, MegaphoneIcon, type LucideIcon } from "lucide-react";

type QuickAction = {
  title: string;
  description: string;
  icon: LucideIcon;
  href: string;
};

const actions: QuickAction[] = [
  {
    title: "Create campaign",
    description: "Group leads and a mailbox into an outbound campaign.",
    icon: MegaphoneIcon,
    href: "/campaigns",
  },
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
];

const MotionLink = motion.create(Link);

const cardClassName =
  "group relative flex cursor-pointer flex-col items-start gap-3 overflow-hidden rounded-xl border border-border bg-gradient-to-br from-card to-muted/40 p-5 text-left shadow-sm outline-none transition-[box-shadow,border-color] duration-150 hover:border-primary/30 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function QuickActions() {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {actions.map((action, index) => (
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
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform duration-150 group-hover:scale-110">
            <action.icon className="size-5" />
          </span>
          <div>
            <p className="font-medium">{action.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{action.description}</p>
          </div>
        </MotionLink>
      ))}
    </div>
  );
}
