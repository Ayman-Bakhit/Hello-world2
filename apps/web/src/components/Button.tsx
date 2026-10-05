import Link from "next/link";
import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";

const BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-xs font-semibold tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-40";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-canvas hover:bg-accent/85",
  secondary: "border border-line-strong bg-surface-2 text-fg hover:border-muted/60",
  ghost: "text-muted hover:text-fg",
};

export function Button({
  variant = "secondary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" className={cn(BASE, VARIANTS[variant], className)} {...props} />;
}

export function ButtonLink({
  href,
  variant = "secondary",
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={cn(BASE, VARIANTS[variant], className)}>
      {children}
    </Link>
  );
}
