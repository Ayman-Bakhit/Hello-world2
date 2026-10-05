import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="rise mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-1.5">{eyebrow}</p> : null}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">{title}</h1>
        {subtitle ? <p className="mt-1.5 max-w-2xl text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
