/**
 * Website workspace on wide screens: the menu column on the left, Main Chat
 * next to it, then a pane with tabs (MonkeCaves, 3D Monke, MonkeMeme). Column
 * widths and open tabs are this browser's preference only (localStorage).
 */
import { create } from "zustand";

export type WorkspaceTab = "caves" | "3d" | "meme";

export const CHAT_MIN = 320;
export const MIDDLE_MIN = 360;
export const SIDEBAR_MIN = 64;
export const SIDEBAR_MAX = 360;
/** Below this the menu column switches to the icon rail. */
export const SIDEBAR_COMPACT_BELOW = 150;
/** Window width needed for the middle pane; narrower windows keep chat + menu. */
export const WORKSPACE_MIN_WINDOW = CHAT_MIN + MIDDLE_MIN + SIDEBAR_MIN + 16;

const KEY = "om.workspace.v1";

interface Saved { chatW: number; sidebarW: number; tabs: WorkspaceTab[]; active: WorkspaceTab | null; touched: boolean }

function load(): Saved {
  const base: Saved = { chatW: 420, sidebarW: 248, tabs: [], active: null, touched: false };
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (!raw) return base;
    const s = JSON.parse(raw) as Partial<Saved>;
    const tabs = Array.isArray(s.tabs) ? s.tabs.filter((x): x is WorkspaceTab => x === "caves" || x === "3d" || x === "meme") : [];
    return {
      chatW: typeof s.chatW === "number" ? s.chatW : base.chatW,
      sidebarW: typeof s.sidebarW === "number" ? s.sidebarW : base.sidebarW,
      tabs,
      active: s.active && tabs.includes(s.active) ? s.active : tabs[0] ?? null,
      touched: !!s.touched,
    };
  } catch {
    return base;
  }
}

interface WorkspaceState extends Saved {
  setChatW: (w: number) => void;
  setSidebarW: (w: number) => void;
  open: (tab: WorkspaceTab) => void;
  close: (tab: WorkspaceTab) => void;
  /** First visit: open the default tab once (closing every tab later is respected). */
  seed: (tab: WorkspaceTab) => void;
}

export const useWorkspace = create<WorkspaceState>((set, get) => {
  const save = () => {
    const { chatW, sidebarW, tabs, active, touched } = get();
    try { localStorage.setItem(KEY, JSON.stringify({ chatW, sidebarW, tabs, active, touched })); } catch { /* private window */ }
  };
  const update = (p: Partial<Saved>) => { set(p); save(); };
  return {
    ...load(),
    setChatW: (w) => update({ chatW: Math.round(w) }),
    setSidebarW: (w) => update({ sidebarW: Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w))) }),
    open: (tab) => {
      const { tabs } = get();
      update({ tabs: tabs.includes(tab) ? tabs : [...tabs, tab], active: tab, touched: true });
    },
    close: (tab) => {
      const { tabs, active } = get();
      const left = tabs.filter((x) => x !== tab);
      update({ tabs: left, active: active === tab ? left[left.length - 1] ?? null : active, touched: true });
    },
    seed: (tab) => { if (!get().touched) update({ tabs: [tab], active: tab, touched: true }); },
  };
});
