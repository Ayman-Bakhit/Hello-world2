"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LAUNCH_CONFIG } from "@/mock";
import type { Launch } from "@project-name/shared";
import type { LaunchConfiguration } from "@/lib/types";
import type { LaunchStepId } from "@/lib/launch";

/** Launch wizard state, shared by /launch and /launch/configuration. In-memory only; nothing is persisted or sent. */
interface LaunchContextValue {
  config: LaunchConfiguration;
  update: (patch: Partial<LaunchConfiguration>) => void;
  setFeeDraft: (bucket: keyof LaunchConfiguration["feeDrafts"], value: string) => void;
  step: LaunchStepId;
  setStep: (s: LaunchStepId) => void;
  /** The configuration most recently saved/reviewed through the API for the CURRENT wizard values. Cleared when values change. */
  savedLaunch: Launch | null;
  setSavedLaunch: (l: Launch | null) => void;
}

const Ctx = createContext<LaunchContextValue | null>(null);

export function LaunchProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<LaunchConfiguration>(DEFAULT_LAUNCH_CONFIG);
  const [step, setStep] = useState<LaunchStepId>("connect");
  const [savedLaunch, setSavedLaunch] = useState<Launch | null>(null);

  const value = useMemo<LaunchContextValue>(
    () => ({
      config,
      update: (patch) => {
        setConfig((c) => ({ ...c, ...patch }));
        setSavedLaunch(null);
      },
      setFeeDraft: (bucket, v) => {
        setConfig((c) => ({ ...c, feeDrafts: { ...c.feeDrafts, [bucket]: v } }));
        setSavedLaunch(null);
      },
      step,
      setStep,
      savedLaunch,
      setSavedLaunch,
    }),
    [config, step, savedLaunch],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLaunch(): LaunchContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLaunch must be used inside LaunchProvider");
  return v;
}
