import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** shadcn/ui-style Button, restyled for the intelligence console. */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[4px] font-mono text-[11px] font-medium uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent text-[#021312] hover:bg-[#5ff0e3] shadow-[0_0_24px_rgba(46,230,214,0.25)]",
        outline: "border border-line-2 bg-panel-2/60 text-text hover:border-accent/60 hover:text-accent",
        ghost: "text-text-2 hover:bg-panel-3 hover:text-accent",
        danger: "border border-alert/50 bg-alert/10 text-alert hover:bg-alert/20",
        ok: "border border-ok/50 bg-ok/10 text-ok hover:bg-ok/20",
      },
      size: {
        sm: "h-7 px-2.5",
        md: "h-9 px-3.5",
        lg: "h-11 px-5 text-[12px]",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = "Button";
