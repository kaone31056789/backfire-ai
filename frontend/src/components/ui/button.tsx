"use client";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/format";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-sm)] text-[14px] font-medium transition-[background,border-color,color,box-shadow,transform] duration-150 ease-[var(--ease-instrument)] active:translate-y-px disabled:pointer-events-none disabled:opacity-45 select-none",
  {
    variants: {
      variant: {
        primary:
          "bg-holds text-[#04140d] shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_0_0_1px_rgba(62,230,168,0.35),0_8px_24px_-8px_rgba(62,230,168,0.45)] hover:bg-[#5cf0ba]",
        signal: "bg-holds/10 text-holds ring-1 ring-inset ring-holds/30 hover:bg-holds/16 hover:ring-holds/50",
        danger: "bg-fail/10 text-fail ring-1 ring-inset ring-fail/30 hover:bg-fail/16",
        outline: "bg-raise/50 text-ink-2 ring-1 ring-inset ring-line-2 hover:text-ink hover:bg-raise hover:ring-ink-4/60",
        ghost: "text-ink-3 hover:text-ink hover:bg-raise/70",
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-9 px-4",
        lg: "h-11 px-5 text-[15px]",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, children, disabled, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...props}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
export { buttonVariants };
