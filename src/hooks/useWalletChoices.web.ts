import { useEffect, useState } from "react";
import { QR_WALLET_NAME, SEEKER_CONNECT_WALLET_NAME, isAndroidBrowser, listWallets, onWalletsChanged, selectWallet } from "@/web/walletStandard";
import { PAIR_CHOICE_KEY, type WalletChoice } from "./useWalletChoices";

export type { WalletChoice };

function labelFor(name: string): string {
  if (name === QR_WALLET_NAME) return "Seeker / Saga — scan QR";
  if (name === SEEKER_CONNECT_WALLET_NAME) return "Seeker wallet via Seeker Connect (beta)";
  if (name === "Mobile Wallet Adapter") return "Seed Vault / phone wallet (recommended)";
  return name;
}

const PAIR_CHOICE: WalletChoice = { key: PAIR_CHOICE_KEY, label: "Seeker / Saga — scan to log in", icon: "📱" };

function current(): WalletChoice[] {
  const pair = isAndroidBrowser() ? [] : [PAIR_CHOICE];
  return [...pair, ...listWallets().map((w) => ({
    key: w.name,
    label: labelFor(w.name),
    icon: "👛",
    iconUri: w.icon,
  }))];
}

/** Web: every Wallet Standard wallet in this browser (+ Seeker Connect on Android). */
export function useWalletChoices(): { choices: WalletChoice[]; choose: (c: WalletChoice) => void } {
  const [choices, setChoices] = useState<WalletChoice[]>(current);
  useEffect(() => onWalletsChanged(() => setChoices(current())), []);
  return { choices, choose: (c) => { if (c.key !== PAIR_CHOICE_KEY) selectWallet(c.key); } };
}
