/**
 * Home-screen widget feed (3.1, OmWidget → ChatWidgetProvider.kt): Main Chat, DMs and
 * MonkeTrades — latest line + unread. Built from the stores the app already keeps, pushed
 * at most every few seconds. With the fingerprint lock on, lines are hidden (counts only).
 * No-op on a binary without the module (3.4).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeModules, Platform } from "react-native";
import { useAppStore } from "@/store/appStore";
import { useChatStore } from "@/store/chatStore";
import { useAppLock } from "@/lib/appLock";
import { notificationPreviewText } from "@/lib/notifications";

const Widget: { update(json: string): void } | undefined = Platform.OS === "android" ? NativeModules.OmWidget : undefined;
const SK = "om_widget_state_v1";
const PUSH_GAP_MS = 3_000;

type Row = { line: string; unread: number };
type State = { mainSeenAt: number; dmLine: string; tradesLine: string };

let _state: State = { mainSeenAt: Date.now(), dmLine: "", tradesLine: "" };
let _loaded = false;
let _timer: ReturnType<typeof setTimeout> | null = null;

/** "MSG:<name>:<text>" → "name: text"; anything else as a short preview. */
export function widgetLine(content: string, fallbackName?: string): string {
  let name = fallbackName;
  let body = content;
  if (content.startsWith("MSG:")) {
    const rest = content.slice(4);
    const i = rest.indexOf(":");
    if (i >= 0) { name = rest.slice(0, i); body = rest.slice(i + 1); }
  }
  const text = notificationPreviewText(body).replace(/\s+/g, " ").trim();
  return (name ? `${name}: ${text}` : text).slice(0, 120);
}

function mainRow(): Row {
  const me = useAppStore.getState().myInboxId;
  const msgs = useChatStore.getState().messages.filter((m) => m.senderAddress !== me);
  const last = msgs.reduce<typeof msgs[number] | null>((a, m) => (!a || m.sentAt > a.sentAt ? m : a), null);
  const unread = msgs.filter((m) => m.sentAt.getTime() > _state.mainSeenAt).length;
  return { line: last ? widgetLine(last.content, last.senderUsername) : "", unread };
}

function snapshot(): string {
  const app = useAppStore.getState();
  const locked = useAppLock.getState().enabled;
  const dmUnread = Object.values(app.dmUnreadCounts ?? {}).reduce((a, b) => a + (b || 0), 0);
  const rows: Record<string, Row> = {
    main: mainRow(),
    dms: { line: _state.dmLine, unread: dmUnread },
    trades: { line: _state.tradesLine, unread: app.botChannelCounts?.trades ?? 0 },
  };
  if (locked) for (const r of Object.values(rows)) r.line = r.unread ? "New messages — unlock to read" : "";
  return JSON.stringify({ ...rows, updatedAt: Date.now() });
}

function persist(): void {
  AsyncStorage.setItem(SK, JSON.stringify(_state)).catch(() => {});
}

/** Only a UI runtime (startHomeWidget ran) redraws: a headless push handler has empty stores. */
export function refreshHomeWidget(): void {
  if (!Widget || !_loaded || _timer) return;
  _timer = setTimeout(() => {
    _timer = null;
    try { Widget.update(snapshot()); } catch { /* widget not placed / module missing */ }
  }, PUSH_GAP_MS);
}

export function noteWidgetDm(name: string, content: string): void {
  _state.dmLine = widgetLine(content, name);
  persist();
  refreshHomeWidget();
}

export function noteWidgetTrades(content: string): void {
  _state.tradesLine = widgetLine(content).replace(/^AI Agent #9385: /, "");
  persist();
  refreshHomeWidget();
}

/** Main Chat was on screen — its unread count resets. */
export function markWidgetMainSeen(): void {
  _state.mainSeenAt = Date.now();
  persist();
  refreshHomeWidget();
}

/** Once at startup: restore lines/seen time, then follow the stores. */
export async function startHomeWidget(): Promise<void> {
  if (!Widget || _loaded) return;
  _loaded = true;
  try {
    const raw = await AsyncStorage.getItem(SK);
    if (raw) _state = { ..._state, ...(JSON.parse(raw) as State) };
  } catch { /* defaults */ }
  useChatStore.subscribe(refreshHomeWidget);
  useAppStore.subscribe((s, prev) => {
    if (s.dmUnreadCounts !== prev.dmUnreadCounts || s.botChannelCounts !== prev.botChannelCounts) refreshHomeWidget();
  });
  useAppLock.subscribe(refreshHomeWidget);
  refreshHomeWidget();
}
