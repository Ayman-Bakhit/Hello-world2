"use client";

import { useWallet } from "@/state/wallet";
import { Button, ButtonLink } from "./Button";

export function ConnectCta() {
  const { ready, openModal } = useWallet();
  return ready ? (
    <ButtonLink href="/portfolio" variant="primary" className="px-5 py-2.5">OPEN PORTFOLIO</ButtonLink>
  ) : (
    <Button variant="primary" className="px-5 py-2.5" onClick={openModal}>CONNECT WALLET</Button>
  );
}
