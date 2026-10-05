import type { ReactNode } from "react";
import { Badge } from "./Badge";

export function EmptyState({
  title,
  description,
  items,
  action,
  badge = "NOT BUILT YET",
}: {
  title: string;
  description: string;
  items?: string[];
  action?: ReactNode;
  badge?: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong bg-surface/60 p-8 text-center sm:p-12">
      {badge ? <Badge tone="neutral">{badge}</Badge> : null}
      <h2 className="mt-4 text-lg font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-muted">{description}</p>
      {items ? (
        <ul className="mx-auto mt-5 grid max-w-xl gap-2 text-left text-sm text-muted sm:grid-cols-2">
          {items.map((i) => (
            <li key={i} className="rounded border border-line bg-surface px-3 py-2">{i}</li>
          ))}
        </ul>
      ) : null}
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}
