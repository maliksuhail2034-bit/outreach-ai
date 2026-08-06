"use client";

import { Button } from "./button";

export interface PaginationProps {
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  className?: string;
}

// Generic, presentational only — decoupled from how a caller actually
// drives navigation (client state vs. a URL search param + Link), so
// whichever page wires this in later (Scalability Track Phase D) picks
// that shape without changing this component. Not used by any page yet.
export function Pagination({ page, pageSize, totalCount, onPageChange, className }: PaginationProps) {
  const totalPages = Math.max(Math.ceil(totalCount / pageSize), 1);
  const hasPrevious = page > 1;
  const hasNext = page < totalPages;

  if (totalPages <= 1) return null;

  return (
    <div className={className ? `flex items-center justify-between gap-3 ${className}` : "flex items-center justify-between gap-3"}>
      <p className="text-sm text-muted-foreground">
        Page {page} of {totalPages}
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!hasPrevious}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={!hasNext} onClick={() => onPageChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
