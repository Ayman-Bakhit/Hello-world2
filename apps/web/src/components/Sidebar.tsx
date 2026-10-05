"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { isActive, NAV } from "./nav";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex h-full flex-col">
      <Link href="/" onClick={onNavigate} className="flex items-center gap-2.5 px-5 py-5">
        <span aria-hidden className="grid h-7 w-7 place-items-center rounded-md border border-accent/40 text-[11px] font-bold text-accent">
          PN
        </span>
        <span className="text-sm font-semibold tracking-wide">PROJECT_NAME</span>
      </Link>

      <ul className="flex-1 space-y-0.5 px-3">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={pathname === item.href ? "page" : undefined}
                className={cn(
                  "flex items-center rounded-md px-3 py-2 text-xs font-semibold tracking-[0.1em] transition-colors",
                  active ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface hover:text-fg",
                )}
              >
                {active ? <span aria-hidden className="mr-2 h-3.5 w-0.5 rounded bg-accent" /> : null}
                {item.label}
              </Link>
              {item.children?.map((c) => (
                <Link
                  key={c.href}
                  href={c.href}
                  onClick={onNavigate}
                  aria-current={pathname === c.href ? "page" : undefined}
                  className={cn(
                    "ml-5 mt-0.5 block rounded-md px-3 py-1.5 text-xs transition-colors",
                    pathname === c.href ? "text-fg" : "text-faint hover:text-muted",
                  )}
                >
                  {c.label}
                </Link>
              ))}
            </li>
          );
        })}
      </ul>

      <div className="space-y-2 border-t border-line px-5 py-4">
        <Link href="/trust" onClick={onNavigate} className="block text-xs font-semibold tracking-wider text-muted hover:text-fg">
          TRUST CENTER
        </Link>
        <p className="text-[11px] leading-snug text-faint">
          VERIFY, DON&apos;T TRUST.
          <br />
          Demo build. No mainnet. No custody.
        </p>
      </div>
    </nav>
  );
}
