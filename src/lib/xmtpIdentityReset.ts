/**
 * Opt-in inbox reset. Per-wallet domain bump + remap + bot addMembers.
 * Does not change XMTP_IDENTITY_DOMAIN. Does not removeMembers.
 */

import { Client } from "@xmtp/react-native-sdk";
import { signBytesWithMwa } from "@/hooks/useMobileWallet";
import { getXmtpClient } from "@/hooks/useXmtp";
import { useAppStore } from "@/store/appStore";
import { bumpWalletBoundXmtpIdentity, getOrInitXmtpClient } from "@/lib/xmtp";
import { postInboxReset, clearBotDmBroken } from "@/lib/botCommand";

export async function resetWalletChatIdentity(): Promise<{ inboxId: string; generation: number }> {
  const wallet = useAppStore.getState().wallet?.address;
  if (!wallet) throw new Error("No wallet connected.");

  const { generation } = await bumpWalletBoundXmtpIdentity(wallet, (bytes) =>
    signBytesWithMwa(wallet, bytes),
  );

  const old = getXmtpClient();
  if (old) {
    try {
      await Client.dropClient((old as { installationId: string }).installationId as any);
    } catch { /* abandoned local installation */ }
  }

  const client = await getOrInitXmtpClient();
  useAppStore.getState().setMyInboxId(client.inboxId);
  await postInboxReset(client.inboxId, generation);
  await clearBotDmBroken();
  return { inboxId: client.inboxId, generation };
}
