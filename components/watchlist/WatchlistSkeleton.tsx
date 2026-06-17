import { WATCHLIST_PAGE_SIZE } from "@/components/watchlist/model";

export function WatchlistSkeleton() {
  return (
    <div className="space-y-3" aria-label="正在加载自选股数据">
      <div className="hidden lg:block">
        {Array.from({ length: WATCHLIST_PAGE_SIZE }, (_, index) => (
          <div key={index} className="grid h-16 grid-cols-[18%_10%_8%_9%_18%_22%_15%] items-center gap-3 border-b border-border/60 last:border-0">
            {Array.from({ length: 7 }, (_item, cellIndex) => (
              <div key={cellIndex} className="h-3 rounded-full bg-muted motion-loading-sweep" />
            ))}
          </div>
        ))}
      </div>
      <div className="space-y-3 lg:hidden">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="glow-card rounded-xl border border-border bg-background/50 p-3">
            <div className="h-4 w-1/3 rounded-full bg-muted motion-loading-sweep" />
            <div className="mt-3 h-3 w-2/3 rounded-full bg-muted motion-loading-sweep" />
            <div className="mt-4 flex gap-2">
              <div className="h-6 w-16 rounded-full bg-muted motion-loading-sweep" />
              <div className="h-6 w-16 rounded-full bg-muted motion-loading-sweep" />
              <div className="h-6 w-20 rounded-full bg-muted motion-loading-sweep" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
