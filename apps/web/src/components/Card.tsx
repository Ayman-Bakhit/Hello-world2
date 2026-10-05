import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

export function Card({
  title,
  right,
  children,
  className,
  id,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("rounded-lg border border-line bg-surface", className)}>
      {title ? (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="eyebrow !text-muted">{title}</h2>
          {right}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}
