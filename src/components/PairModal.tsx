import type { WalletAccount } from "@/types";

/** Native: phone pairing is a web-only desktop login. */
export function PairModal(_props: { visible: boolean; onClose: () => void; onPaired: (account: WalletAccount) => void }) {
  return null;
}
