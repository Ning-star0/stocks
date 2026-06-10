"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { WATCHLIST_PAGE_SIZE } from "@/components/watchlist/model";
import { cn } from "@/lib/utils";

export function PaginationControls({
  currentPage,
  totalPages,
  totalItems,
  pageStart,
  pageEnd,
  onPageChange,
  className
}: {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageStart: number;
  pageEnd: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  if (totalItems <= WATCHLIST_PAGE_SIZE) return null;

  return (
    <div className={cn("flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="tabular-nums">
        第 {pageStart}-{pageEnd} 条 / 共 {totalItems} 条
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
        >
          <ChevronLeft className="h-4 w-4" />
          上一页
        </Button>
        <span className="min-w-16 text-center tabular-nums">
          {currentPage} / {totalPages}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage >= totalPages}
        >
          下一页
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
