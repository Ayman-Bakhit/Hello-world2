"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LAUNCH_CONFIG } from "@/mock";
import type { Launch } from "@project-name/shared";
import type { LaunchConfiguration } from "@/lib/types";
import type { LaunchStepId } from "@/lib/launch";

/**
 * Launch wizard state, shared by /launch and /launch/configuration. The editor values live in memory; the saved configuration
 * (`savedLaunch`) lives on the server. `dirty` = the editor differs from what was last saved.
 */
interface LaunchContextValue {
  config: LaunchConfiguration;
  update: (patch: Partial<LaunchConfiguration>) => void;
  step: LaunchStepId;
  setStep: (s: LaunchStepId) => void;
  /** The configuration most recently saved or advanced through the API (this editing session). */
  savedLaunch: Launch | null;
  setSavedLaunch: (l: Launch | null) => void;
  /** True when the editor has changes that are not saved yet. Saving returns the launch to DRAFT. */
  dirty: boolean;
  markSaved: () => void;
}

const Ctx = createContext<LaunchContextValue | null>(null);

export function LaunchProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<LaunchConfiguration>(DEFAULT_LAUNCH_CONFIG);
  const [step, setStep] = useState<LaunchStepId>("connect");
  const [savedLaunch, setSavedLaunch] = useState<Launch | null>(null);
  const [dirty, setDirty] = useState(false);

  const value = useMemo<LaunchContextValue>(
    () => ({
      config,
      update: (patch) => {
        setConfig((c) => ({ ...c, ...patch }));
        setDirty(true);
      },
      step,
      setStep,
      savedLaunch,
      setSavedLaunch,
      dirty,
      markSaved: () => setDirty(false),
    }),
    [config, step, savedLaunch, dirty],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLaunch(): LaunchContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLaunch must be used inside LaunchProvider");
  return v;
}
