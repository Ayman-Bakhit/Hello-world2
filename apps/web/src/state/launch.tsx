"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LAUNCH_CONFIG } from "@/mock";
import type { LaunchConfiguration } from "@/lib/types";
import type { LaunchStepId } from "@/lib/launch";

/** Launch wizard state, shared by /launch and /launch/configuration. In-memory only; nothing is persisted or sent. */
interface LaunchContextValue {
  config: LaunchConfiguration;
  update: (patch: Partial<LaunchConfiguration>) => void;
  setFeeDraft: (bucket: keyof LaunchConfiguration["feeDrafts"], value: string) => void;
  step: LaunchStepId;
  setStep: (s: LaunchStepId) => void;
  mockDeployed: boolean;
  setMockDeployed: (v: boolean) => void;
}

const Ctx = createContext<LaunchContextValue | null>(null);

export function LaunchProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<LaunchConfiguration>(DEFAULT_LAUNCH_CONFIG);
  const [step, setStep] = useState<LaunchStepId>("connect");
  const [mockDeployed, setMockDeployed] = useState(false);

  const value = useMemo<LaunchContextValue>(
    () => ({
      config,
      update: (patch) => {
        setConfig((c) => ({ ...c, ...patch }));
        setMockDeployed(false);
      },
      setFeeDraft: (bucket, v) => {
        setConfig((c) => ({ ...c, feeDrafts: { ...c.feeDrafts, [bucket]: v } }));
        setMockDeployed(false);
      },
      step,
      setStep,
      mockDeployed,
      setMockDeployed,
    }),
    [config, step, mockDeployed],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLaunch(): LaunchContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLaunch must be used inside LaunchProvider");
  return v;
}
