import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium shadow-[inset_0_1px_0_hsl(0_0%_100%/0.35),0_8px_24px_hsl(220_30%_18%/0.08)] backdrop-blur-xl transition-all duration-150 hover:-translate-y-px active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:translate-y-0 disabled:scale-100 disabled:border-border/70 disabled:bg-muted/70 disabled:text-muted-foreground disabled:shadow-none disabled:opacity-100 dark:disabled:bg-white/8 [&_svg]:transition-transform [&_svg]:duration-150 [&:hover_svg]:-translate-y-px",
  {
    variants: {
      variant: {
        default: "border border-primary/30 bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "border border-destructive/30 bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-white/55 bg-white/42 text-foreground hover:border-primary/35 hover:bg-white/62 dark:border-white/10 dark:bg-white/7 dark:hover:bg-white/12",
        secondary: "border border-white/45 bg-white/38 text-secondary-foreground hover:bg-white/58 dark:border-white/10 dark:bg-white/8 dark:hover:bg-white/13",
        ghost: "border border-transparent shadow-none hover:border-white/35 hover:bg-white/38 dark:hover:border-white/10 dark:hover:bg-white/8",
        link: "text-primary underline-offset-4 hover:underline"
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        icon: "h-9 w-9"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
