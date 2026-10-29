import React from "react";
import { Text } from "react-native";
import { render } from "@testing-library/react-native";

jest.mock("@/lib/constants", () => ({ THEME: { bg: "#000", text: "#fff", textMuted: "#888", accent: "#70f", accentSoft: "#70f3", success: "#0f0", error: "#f00" }, FONTS: {} }));
let mockWidth = 400;
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({ __esModule: true, default: () => ({ width: mockWidth, height: 800, scale: 1, fontScale: 1 }) }));
jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, usePathname: () => "/chat" }));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
const mockApp = { wallet: { address: "w" }, verified: true, isGenesisHolder: false };
jest.mock("@/store/appStore", () => ({ useAppStore: (sel: (s: any) => any) => sel(mockApp) }));
const mockTrades = {
  portfolioResponse: { ts: Date.now() - 5 * 60_000, walletBalanceSOL: 1.234, winRate: 47, positions: [{ positionId: "p1", token: "ORE", currentSolValue: 0.21, pnlPct: 4.2 }] },
  openTrades: [],
  closedTrades: [{ id: "c1", token: "BOME", closedAt: Date.now() - 2 * 3600_000, pnlPct: -6.9 }],
};
jest.mock("@/store/tradesStore", () => ({ useTradesStore: (sel: (s: any) => any) => sel(mockTrades) }));

import { WideShell } from "../components/WideShell.web";

const at = (width: number) => { mockWidth = width; };

test("phone width: only the screen", () => {
  at(400);
  const r = render(<WideShell><Text>SCREEN</Text></WideShell>);
  expect(r.getByText("SCREEN")).toBeTruthy();
  expect(r.queryByText("wide.mainChat")).toBeNull();
});

test("car / laptop width: rail, no panel", () => {
  at(920);
  const r = render(<WideShell><Text>SCREEN</Text></WideShell>);
  expect(r.getByText("wide.mainChat")).toBeTruthy();
  expect(r.getByText("MonkeTrades")).toBeTruthy();
  expect(r.queryByText("wide.bags")).toBeNull();
});

test("desktop width: rail and bags panel", () => {
  at(1400);
  const r = render(<WideShell><Text>SCREEN</Text></WideShell>);
  expect(r.getByText("wide.bags")).toBeTruthy();
  expect(r.getByText("$ORE")).toBeTruthy();
  expect(r.getByText("+4.2%")).toBeTruthy();
  expect(r.getByText("$BOME")).toBeTruthy();
  expect(r.getByText("-6.9%")).toBeTruthy();
});

test("old or partial trade records never break the page", () => {
  at(1400);
  const keep = { ...mockTrades };
  Object.assign(mockTrades, {
    portfolioResponse: { ts: undefined, walletBalanceSOL: null, winRate: undefined, positions: [{ token: "OLD" }] },
    closedTrades: [{ token: "NOPNL" }],
  });
  const r = render(<WideShell><Text>SCREEN</Text></WideShell>);
  expect(r.getByText("SCREEN")).toBeTruthy();
  expect(r.getByText("$OLD")).toBeTruthy();
  expect(r.getByText("$NOPNL")).toBeTruthy();
  Object.assign(mockTrades, keep);
});
