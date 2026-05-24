import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium shadow-[inset_0_1px_0_hsl(0_0%_100%/0.22)] transition-colors",
  {
    variants: {
      variant: {
        default: "border-primary/25 bg-primary text-primary-foreground",
        secondary: "border-white/38 bg-white/36 text-secondary-foreground dark:border-white/10 dark:bg-white/8",
        outline: "border-white/40 bg-white/24 text-foreground dark:border-white/10 dark:bg-white/6",
        success: "border-emerald-500/30 bg-emerald-500/12 text-emerald-600 dark:text-emerald-300",
        warning: "border-amber-500/30 bg-amber-500/12 text-amber-700 dark:text-amber-300",
        danger: "border-red-500/30 bg-red-500/12 text-red-700 dark:text-red-300"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
