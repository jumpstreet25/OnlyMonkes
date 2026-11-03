/**
 * Every share carries a link back to the app: the sharer's own invite
 * (onlymonkes.app/r/<code> — a card with their monke, a QR and the referral
 * bonus) or, without one, onlymonkes.app/get. Fetching the invite needs the
 * phone's verified hardware key and never prompts the wallet here, so a share
 * is never blocked: no invite yet → the /get link. The invite is cached per
 * wallet once known (getMyReferral also stores it).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAppStore } from "@/store/appStore";
import { getMyReferral, isReferralError } from "@/lib/referrals";

export const FALLBACK_SHARE_LINK = "https://onlymonkes.app/get";
const AK = "om_share_link:";
const INVITE_URL = /^https:\/\/onlymonkes\.app\/r\/[2-9A-HJ-NP-Z]{6}$/;
const LOOKUP_MS = 4_000;

/** Appends the link on its own line unless the text already points at onlymonkes.app. */
export function withShareLink(message: string, link: string): string {
  if (/onlymonkes\.app/i.test(message)) return message;
  return `${message.trimEnd()}\n${link}`;
}

export async function rememberShareLink(wallet: string, url: string): Promise<void> {
  if (!INVITE_URL.test(url)) return;
  await AsyncStorage.setItem(AK + wallet, url).catch(() => {});
}

export async function getShareLink(): Promise<string> {
  const wallet = useAppStore.getState().wallet?.address;
  if (!wallet) return FALLBACK_SHARE_LINK;
  try {
    const cached = await AsyncStorage.getItem(AK + wallet);
    if (cached && INVITE_URL.test(cached)) return cached;
  } catch { /* fall through */ }
  try {
    const r = await Promise.race([
      getMyReferral({ canPrompt: false }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), LOOKUP_MS)),
    ]);
    if (r && !isReferralError(r) && INVITE_URL.test(r.url)) return r.url;
  } catch { /* fall through */ }
  return FALLBACK_SHARE_LINK;
}

/** The message with the sharer's link appended. */
export async function addShareLink(message: string): Promise<string> {
  if (/onlymonkes\.app/i.test(message)) return message;
  return withShareLink(message, await getShareLink());
}
