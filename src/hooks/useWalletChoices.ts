/** Web desktop only: "log in by scanning with your Seeker" (src/components/PairModal). */
export const PAIR_CHOICE_KEY = "pair-with-phone";

export type WalletChoice = {
  key: string;
  label: string;
  icon: string;
  iconUri?: string;
  scheme?: string;
};

const NATIVE_CHOICES: WalletChoice[] = [
  { key: "phantom", icon: "🟣", label: "Phantom", scheme: "phantom://" },
  { key: "solflare", icon: "🔥", label: "Solflare", scheme: "solflare://" },
  { key: "mwa", icon: "📱", label: "Mobile Wallet Adapter" },
];

/** Wallet rows for the connect sheet. Native: the MWA wallet apps. */
export function useWalletChoices(): { choices: WalletChoice[]; choose: (c: WalletChoice) => void } {
  return { choices: NATIVE_CHOICES, choose: () => {} };
}
