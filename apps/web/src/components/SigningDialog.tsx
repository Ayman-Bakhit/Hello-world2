"use client";

import { Badge } from "./Badge";
import { Button } from "./Button";

export interface SigningRow {
  label: string;
  value: string;
}

/** "WHAT YOU ARE SIGNING" summary. In this build it never offers a real signature. */
export function SigningDialog({ title, rows, onClose }: { title: string; rows: SigningRow[]; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <button type="button" aria-label="Close" className="absolute inset-0 cursor-default" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="sign-title" className="rise relative w-full max-w-md rounded-xl border border-line-strong bg-surface p-5 shadow-2xl">
        <div className="mb-1 flex items-center gap-2">
          <Badge tone="demo">DEMO · NOTHING IS SENT</Badge>
        </div>
        <h2 id="sign-title" className="text-base font-semibold">WHAT YOU ARE SIGNING</h2>
        <p className="mb-3 text-xs text-muted">{title}</p>
        <dl className="divide-y divide-line rounded-md border border-line">
          {rows.map((r) => (
            <div key={r.label} className="flex justify-between gap-4 px-3 py-2 text-sm">
              <dt className="text-muted">{r.label}</dt>
              <dd className="num text-right">{r.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-faint">
          In the real flow, every destination is shown here before your wallet asks for a signature. The platform never
          holds your keys and cannot move your funds.
        </p>
        <div className="mt-4 flex gap-2">
          <Button onClick={onClose} autoFocus>CLOSE</Button>
          <Button variant="primary" disabled title="Signing is not implemented in this build.">SIGN WITH WALLET</Button>
        </div>
      </div>
    </div>
  );
}
