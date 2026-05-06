/**
 * BananaMowerOverlay — chat-screen-level wrapper that renders the MonkeMower
 * above the chat content. BananaGroveWorld lives in WorldLayer (background);
 * if the mower were rendered there, FlashList + chat input would cover it.
 * This overlay reads the shared mower store and renders the mower in the
 * foreground so the cleanup moment is fully visible.
 *
 * Renders nothing when the mower is inactive — zero overhead in idle state.
 */

import React from "react";
import { useMowerStore, mowerIntakeXSV } from "@/lib/bananaMowerState";
import { MonkeMower } from "@/components/worlds/MonkeMower";

export function BananaMowerOverlay() {
  const active = useMowerStore((s) => s.active);
  const crateCount = useMowerStore((s) => s.crateCount);
  const pileBottomPx = useMowerStore((s) => s.pileBottomPx);
  const pfpUri = useMowerStore((s) => s.pfpUri);
  const onComplete = useMowerStore((s) => s.onComplete);

  if (!active || !onComplete) return null;

  return (
    <MonkeMower
      active={active}
      pfpUri={pfpUri}
      bottomPx={pileBottomPx}
      intakeX={mowerIntakeXSV}
      crateCount={crateCount}
      onComplete={onComplete}
    />
  );
}
