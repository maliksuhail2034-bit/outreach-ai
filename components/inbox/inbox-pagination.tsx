"use client";

import { useRouter } from "next/navigation";

import { Pagination } from "@/components/ui/pagination";

// URL-driven, same as components/campaigns/campaign-list.tsx.
export function InboxPagination({ page, pageSize, totalCount }: { page: number; pageSize: number; totalCount: number }) {
  const router = useRouter();
  return (
    <Pagination
      page={page}
      pageSize={pageSize}
      totalCount={totalCount}
      onPageChange={(nextPage) => router.push(`/inbox?page=${nextPage}`)}
    />
  );
}
