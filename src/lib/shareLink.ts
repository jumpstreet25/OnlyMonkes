/**
 * Every share carries a link back to the app: the sharer's own invite
 * (onlymonkes.app/r/<code> — a card with their monke, a QR and the referral
 * bonus) or, without one, onlymonkes.app/get. Fetching the invite needs the
 * phone's verified hardware key and never prompts the wallet during a share,
 * so a share is never blocked: no invite yet → the /get link. The invite is
 * cached per wallet once known (getMyReferral also stores it).
 *
 * prepareShareLink() runs once after sign-in (app/_layout.tsx): if this wallet
 * has no invite cached it fetches one, which verifies the phone first when
 * needed (one wallet signature). A declined or failed attempt waits 7 days.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { useAppStore } from "@/store/appStore";
import { getMyReferral, isReferralError } from "@/lib/referrals";

export const FALLBACK_SHARE_LINK = "https://onlymonkes.app/get";
const AK = "om_share_link:";
const INVITE_URL = /^https:\/\/onlymonkes\.app\/r\/[2-9A-HJ-NP-Z]{6}$/;
const LOOKUP_MS = 4_000;
const AK_TRIED = "om_share_link_tried:";
const RETRY_MS = 7 * 24 * 60 * 60 * 1000;

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
  const cached = await cachedInvite(wallet);
  if (cached) return cached;
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const r = await Promise.race([
      getMyReferral({ canPrompt: false }),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), LOOKUP_MS); }),
    ]).finally(() => clearTimeout(timer));
    if (r && !isReferralError(r) && INVITE_URL.test(r.url)) return r.url;
  } catch { /* fall through */ }
  return FALLBACK_SHARE_LINK;
}

async function cachedInvite(wallet: string): Promise<string | null> {
  try {
    const cached = await AsyncStorage.getItem(AK + wallet);
    return cached && INVITE_URL.test(cached) ? cached : null;
  } catch {
    return null;
  }
}

/** After sign-in: make sure shares carry this holder's invite (may ask for one wallet signature). */
export async function prepareShareLink(): Promise<void> {
  if (Platform.OS !== "android") return;
  const wallet = useAppStore.getState().wallet?.address;
  if (!wallet || (await cachedInvite(wallet))) return;
  try {
    const tried = Number(await AsyncStorage.getItem(AK_TRIED + wallet));
    if (tried && Date.now() - tried < RETRY_MS) return;
    await AsyncStorage.setItem(AK_TRIED + wallet, String(Date.now()));
  } catch {
    return;
  }
  await getMyReferral().catch(() => null);
}

/** The message with the sharer's link appended. */
export async function addShareLink(message: string): Promise<string> {
  if (/onlymonkes\.app/i.test(message)) return message;
  return withShareLink(message, await getShareLink());
}
