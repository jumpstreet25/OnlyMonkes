import React from "react";
import { Text } from "react-native";
import { render } from "@testing-library/react-native";

let mockWidth = 400;
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({ __esModule: true, default: () => ({ width: mockWidth, height: 800, scale: 1, fontScale: 1 }) }));
jest.mock("@/lib/constants", () => ({ THEME: { bg: "#000", text: "#fff", textMuted: "#888", accent: "#70f", accentSoft: "#70f3", success: "#0f0", error: "#f00" }, FONTS: {} }));
let mockPath = "/chat";
jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, usePathname: () => mockPath }));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
const mockApp = { wallet: { address: "w" }, verified: true, isGenesisHolder: false };
jest.mock("@/store/appStore", () => ({ useAppStore: (sel: (s: any) => any) => sel(mockApp) }));
const mockTrades: any = {
  portfolioResponse: { ts: Date.now() - 5 * 60_000, walletBalanceSOL: 1.234, winRate: 47, positions: [{ positionId: "p1", token: "ORE", currentSolValue: 0.21, pnlPct: 4.2 }] },
  openTrades: [],
  closedTrades: [{ id: "c1", token: "BOME", closedAt: Date.now() - 2 * 3600_000, pnlPct: -6.9 }],
};
jest.mock("@/store/tradesStore", () => ({ useTradesStore: (sel: (s: any) => any) => sel(mockTrades) }));

import { WideShell, paneScreens } from "../components/WideShell.web";

paneScreens.trades = ({ headerAccessory }: any) => <>{headerAccessory}<Text>TRADES CHANNEL</Text></>;
paneScreens.messages = ({ headerAccessory }: any) => <>{headerAccessory}<Text>DM LIST</Text></>;

const at = (width: number) => { mockWidth = width; };
const saved = (v: object | null) => {
  (globalThis as any).localStorage = { getItem: () => (v ? JSON.stringify(v) : null), setItem: jest.fn() };
};
beforeEach(() => { mockPath = "/chat"; saved(null); });

test("phone width: only the screen", () => {
  at(400);
  const r = render(<WideShell><Text>SCREEN</Text></WideShell>);
  expect(r.getByText("SCREEN")).toBeTruthy();
  expect(r.queryByText("wide.mainChat")).toBeNull();
});

test("car / laptop width: rail plus one column (MonkeTrades by default)", async () => {
  at(920);
  const r = render(<WideShell><Text>SCREEN</Text></WideShell>);
  expect(r.getByText("wide.mainChat")).toBeTruthy();
  expect(await r.findByText("TRADES CHANNEL")).toBeTruthy();
  expect(r.queryByText("DM LIST")).toBeNull();
});

test("desktop width: Trader default — Messages left, MonkeTrades right", async () => {
  at(1400);
  const r = render(<WideShell><Text>SCREEN</Text></WideShell>);
  expect(await r.findByText("DM LIST")).toBeTruthy();
  expect(await r.findByText("TRADES CHANNEL")).toBeTruthy();
});

test("no second copy when the middle already shows MonkeTrades", async () => {
  at(1400);
  mockPath = "/bot-channel";
  const r = render(<WideShell><Text>SCREEN</Text></WideShell>);
  expect(await r.findByText("wide.openInMiddle")).toBeTruthy();
  expect(r.queryByText("TRADES CHANNEL")).toBeNull();
});

test("bags column, including old or partial records", async () => {
  at(1400);
  saved({ left: "off", right: "bags" });
  const keep = { ...mockTrades };
  Object.assign(mockTrades, {
    portfolioResponse: { ts: undefined, walletBalanceSOL: null, winRate: undefined, positions: [{ token: "OLD" }, { positionId: "p1", token: "ORE", currentSolValue: 0.21, pnlPct: 4.2 }] },
    closedTrades: [{ token: "NOPNL" }],
  });
  const r = render(<WideShell><Text>SCREEN</Text></WideShell>);
  expect(await r.findByText("$OLD")).toBeTruthy();
  expect(r.getByText("+4.2%")).toBeTruthy();
  expect(r.getByText("$NOPNL")).toBeTruthy();
  expect(r.queryByText("DM LIST")).toBeNull();
  Object.assign(mockTrades, keep);
});
