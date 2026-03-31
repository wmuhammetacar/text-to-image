import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-xl text-sm font-medium transition duration-200 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[0_10px_30px_-14px_rgba(108,59,255,0.85)] hover:-translate-y-0.5 hover:bg-primary/95 hover:shadow-[0_16px_34px_-16px_rgba(108,59,255,0.95)]",
        secondary: "bg-secondary/90 text-secondary-foreground hover:-translate-y-0.5 hover:bg-secondary",
        outline: "bg-white/5 text-card-foreground hover:-translate-y-0.5 hover:bg-white/10",
        ghost: "text-foreground hover:bg-white/8 hover:text-white",
        danger: "bg-danger text-danger-foreground hover:bg-danger/90",
      },
      size: {
        sm: "h-9 px-3",
        md: "h-10 px-4",
        lg: "h-11 px-6",
      },
      fullWidth: {
        true: "w-full",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
      fullWidth: false,
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, fullWidth, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, fullWidth, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";

export { Button, buttonVariants };
