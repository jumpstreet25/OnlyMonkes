/**
 * MenuIcon — Skia-rendered vector icons for the hamburger menu.
 *
 * Replaces emoji glyphs (✉️🏆📅🖼🔗💼👁🏪🔧🌍⚙️) with cohesive procedural
 * shapes that adopt the world accent (warm honey gold for Banana Grove,
 * neon pink Cyberpunk, gold Trading Floor, light blue default).
 *
 * Visual language matches BotChannelIcon:
 *   - Clean outlined shapes, ~3.5% stroke width
 *   - Small solid-filled accents where appropriate
 *   - Round line caps + joins for clean intersections
 *   - Single color per icon, passed via `color` prop
 *
 * Geometry designed at a 28-unit logical canvas; size prop scales the
 * canvas + all coordinates proportionally.
 */
import React from "react";
import {
  Canvas,
  Group,
  Path,
  Circle,
  RoundedRect,
} from "@shopify/react-native-skia";

export type MenuIconName =
  | "messages"
  | "leaderboard"
  | "events"
  | "images"
  | "links"
  | "portfolio"
  | "watchlist"
  | "monkemarkets"
  | "monketools"
  | "globe"
  | "settings";

interface MenuIconProps {
  name: MenuIconName;
  size?: number;
  color: string;
}

export const MenuIcon = React.memo(function MenuIcon({
  name,
  size = 28,
  color,
}: MenuIconProps) {
  // All icons are designed in a 28-unit logical space; we scale by `s`.
  const s = size / 28;

  return (
    <Canvas style={{ width: size, height: size }} pointerEvents="none">
      {name === "messages" && <MessagesIcon s={s} color={color} />}
      {name === "leaderboard" && <LeaderboardIcon s={s} color={color} />}
      {name === "events" && <EventsIcon s={s} color={color} />}
      {name === "images" && <ImagesIcon s={s} color={color} />}
      {name === "links" && <LinksIcon s={s} color={color} />}
      {name === "portfolio" && <PortfolioIcon s={s} color={color} />}
      {name === "watchlist" && <WatchlistIcon s={s} color={color} />}
      {name === "monkemarkets" && <MonkeMarketsIcon s={s} color={color} />}
      {name === "monketools" && <MonkeToolsIcon s={s} color={color} />}
      {name === "globe" && <GlobeIcon s={s} color={color} />}
      {name === "settings" && <SettingsIcon s={s} color={color} />}
    </Canvas>
  );
});

const STROKE = 1.0; // logical-units stroke base; scaled by s in renders

// ── Messages — envelope + flap ─────────────────────────────────────────────
function MessagesIcon({ s, color }: { s: number; color: string }) {
  // Envelope rect from (3,8) to (25,21), flap diagonals from upper corners
  // to center-top meeting at (14, 14).
  const stroke = STROKE * s;
  const r = 1.5 * s;
  const flapPath = `M ${3 * s} ${8 * s} L ${14 * s} ${14 * s} L ${25 * s} ${8 * s}`;
  return (
    <Group>
      <RoundedRect x={3 * s} y={8 * s} width={22 * s} height={13 * s} r={r} color={color} style="stroke" strokeWidth={stroke} />
      <Path path={flapPath} color={color} style="stroke" strokeWidth={stroke} strokeCap="round" strokeJoin="round" />
    </Group>
  );
}

// ── Leaderboard — 3-bar podium (1st tallest center) ────────────────────────
function LeaderboardIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  const r = 0.8 * s;
  return (
    <Group>
      {/* 2nd place — left, mid */}
      <RoundedRect x={3 * s} y={14 * s} width={6.5 * s} height={11 * s} r={r} color={color} style="stroke" strokeWidth={stroke} />
      {/* 1st place — center, tallest */}
      <RoundedRect x={10.75 * s} y={9 * s} width={6.5 * s} height={16 * s} r={r} color={color} style="stroke" strokeWidth={stroke} />
      {/* 3rd place — right, shortest */}
      <RoundedRect x={18.5 * s} y={17 * s} width={6.5 * s} height={8 * s} r={r} color={color} style="stroke" strokeWidth={stroke} />
    </Group>
  );
}

// ── Events — calendar with binding pegs ────────────────────────────────────
function EventsIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  const r = 1.5 * s;
  // 2 binding pegs at top (vertical lines extending above the calendar body)
  const pegPath = `M ${9 * s} ${3 * s} L ${9 * s} ${8 * s} M ${19 * s} ${3 * s} L ${19 * s} ${8 * s}`;
  // Header divider line under the pegs
  const headerLine = `M ${4 * s} ${10 * s} L ${24 * s} ${10 * s}`;
  // Small dot inside indicating an event
  return (
    <Group>
      <RoundedRect x={4 * s} y={6 * s} width={20 * s} height={19 * s} r={r} color={color} style="stroke" strokeWidth={stroke} />
      <Path path={pegPath} color={color} style="stroke" strokeWidth={stroke * 1.2} strokeCap="round" />
      <Path path={headerLine} color={color} style="stroke" strokeWidth={stroke} strokeCap="round" />
      {/* Day-cell dots */}
      <Circle cx={9 * s} cy={15 * s} r={1.0 * s} color={color} />
      <Circle cx={14 * s} cy={15 * s} r={1.0 * s} color={color} />
      <Circle cx={19 * s} cy={15 * s} r={1.0 * s} color={color} />
      <Circle cx={9 * s} cy={20 * s} r={1.0 * s} color={color} />
      <Circle cx={14 * s} cy={20 * s} r={1.0 * s} color={color} />
    </Group>
  );
}

// ── Images — mountain peaks inside a frame ─────────────────────────────────
function ImagesIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  const r = 1.5 * s;
  // Two mountain peaks
  const mountains = `
    M ${5 * s} ${21 * s}
    L ${11 * s} ${13 * s}
    L ${15 * s} ${17 * s}
    L ${19 * s} ${12 * s}
    L ${24 * s} ${21 * s}
  `;
  // Small sun/moon circle (filled accent)
  return (
    <Group>
      <RoundedRect x={3 * s} y={5 * s} width={22 * s} height={20 * s} r={r} color={color} style="stroke" strokeWidth={stroke} />
      <Circle cx={9 * s} cy={11 * s} r={1.6 * s} color={color} />
      <Path path={mountains} color={color} style="stroke" strokeWidth={stroke} strokeCap="round" strokeJoin="round" />
    </Group>
  );
}

// ── Links — two interlocking ring segments ─────────────────────────────────
function LinksIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s * 1.1;
  // Left link — open right side via arc that doesn't fully close
  // Right link mirrored
  // Approximate using two ring-shaped paths drawn with strokes
  const left = `
    M ${10 * s} ${9 * s}
    A ${5 * s} ${5 * s} 0 1 0 ${10 * s} ${19 * s}
  `;
  const right = `
    M ${18 * s} ${9 * s}
    A ${5 * s} ${5 * s} 0 1 1 ${18 * s} ${19 * s}
  `;
  // Connecting bridge — overlaps where the two rings interlock
  const bridge = `M ${10 * s} ${14 * s} L ${18 * s} ${14 * s}`;
  return (
    <Group>
      <Path path={left} color={color} style="stroke" strokeWidth={stroke} strokeCap="round" />
      <Path path={right} color={color} style="stroke" strokeWidth={stroke} strokeCap="round" />
      <Path path={bridge} color={color} style="stroke" strokeWidth={stroke} strokeCap="round" />
    </Group>
  );
}

// ── Portfolio — briefcase ──────────────────────────────────────────────────
function PortfolioIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  const r = 1.2 * s;
  // Handle arc above the body
  const handle = `
    M ${10 * s} ${10 * s}
    L ${10 * s} ${7 * s}
    Q ${10 * s} ${5 * s} ${12 * s} ${5 * s}
    L ${16 * s} ${5 * s}
    Q ${18 * s} ${5 * s} ${18 * s} ${7 * s}
    L ${18 * s} ${10 * s}
  `;
  // Latch line crossing the body
  const latch = `M ${4 * s} ${16 * s} L ${24 * s} ${16 * s}`;
  return (
    <Group>
      <Path path={handle} color={color} style="stroke" strokeWidth={stroke} strokeCap="round" strokeJoin="round" />
      <RoundedRect x={4 * s} y={10 * s} width={20 * s} height={14 * s} r={r} color={color} style="stroke" strokeWidth={stroke} />
      <Path path={latch} color={color} style="stroke" strokeWidth={stroke * 0.85} />
    </Group>
  );
}

// ── Watchlist — eye ────────────────────────────────────────────────────────
function WatchlistIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  // Almond eye outline using two arcs (top + bottom)
  const eye = `
    M ${3 * s} ${14 * s}
    Q ${14 * s} ${5 * s} ${25 * s} ${14 * s}
    Q ${14 * s} ${23 * s} ${3 * s} ${14 * s}
    Z
  `;
  return (
    <Group>
      <Path path={eye} color={color} style="stroke" strokeWidth={stroke} strokeJoin="round" />
      {/* Pupil */}
      <Circle cx={14 * s} cy={14 * s} r={3 * s} color={color} style="stroke" strokeWidth={stroke} />
      <Circle cx={14 * s} cy={14 * s} r={1.4 * s} color={color} />
    </Group>
  );
}

// ── MonkeMarkets — storefront with awning + door ───────────────────────────
function MonkeMarketsIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  // Awning at top — flat with scalloped lower edge approximated by 3 dips
  const awning = `
    M ${3 * s} ${5 * s}
    L ${25 * s} ${5 * s}
    L ${25 * s} ${10 * s}
    L ${21 * s} ${10 * s}
    L ${20 * s} ${12 * s}
    L ${19 * s} ${10 * s}
    L ${15 * s} ${10 * s}
    L ${14 * s} ${12 * s}
    L ${13 * s} ${10 * s}
    L ${9 * s} ${10 * s}
    L ${8 * s} ${12 * s}
    L ${7 * s} ${10 * s}
    L ${3 * s} ${10 * s}
    Z
  `;
  // Storefront body — rectangular with door cut-out (rendered as separate door rect)
  const body = `M ${5 * s} ${10 * s} L ${5 * s} ${25 * s} L ${23 * s} ${25 * s} L ${23 * s} ${10 * s}`;
  // Door — small rounded-top arch in the middle
  const door = `
    M ${11 * s} ${25 * s}
    L ${11 * s} ${17 * s}
    Q ${11 * s} ${15 * s} ${14 * s} ${15 * s}
    Q ${17 * s} ${15 * s} ${17 * s} ${17 * s}
    L ${17 * s} ${25 * s}
  `;
  return (
    <Group>
      <Path path={awning} color={color} style="stroke" strokeWidth={stroke} strokeJoin="round" />
      <Path path={body} color={color} style="stroke" strokeWidth={stroke} strokeJoin="round" />
      <Path path={door} color={color} style="stroke" strokeWidth={stroke} strokeJoin="round" />
    </Group>
  );
}

// ── Monke Tools — wrench ───────────────────────────────────────────────────
function MonkeToolsIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  // Open-end wrench: jaw at top-left, handle going down-right.
  // Jaw is a U-shape, handle is a thick line tilted ~45°.
  const wrench = `
    M ${4 * s} ${4 * s}
    Q ${3 * s} ${8 * s} ${6 * s} ${10 * s}
    L ${8 * s} ${8 * s}
    L ${22 * s} ${22 * s}
    Q ${24 * s} ${24 * s} ${22 * s} ${22 * s}
    L ${24 * s} ${20 * s}
    Q ${26 * s} ${22 * s} ${24 * s} ${24 * s}
    Q ${22 * s} ${26 * s} ${20 * s} ${24 * s}
    L ${10 * s} ${14 * s}
    L ${8 * s} ${16 * s}
    Q ${4 * s} ${14 * s} ${4 * s} ${10 * s}
    Z
  `;
  return (
    <Group>
      <Path path={wrench} color={color} style="stroke" strokeWidth={stroke} strokeJoin="round" />
    </Group>
  );
}

// ── Globe — sphere with meridians + latitudes ──────────────────────────────
function GlobeIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  const cx = 14 * s;
  const cy = 14 * s;
  const r = 10 * s;
  // Vertical meridian
  const meridian = `M ${cx} ${cy - r} Q ${cx + 4 * s} ${cy} ${cx} ${cy + r} M ${cx} ${cy - r} Q ${cx - 4 * s} ${cy} ${cx} ${cy + r}`;
  // Horizontal latitudes (3 — equator + 2 tropics)
  const latitudes = `
    M ${cx - r} ${cy} L ${cx + r} ${cy}
    M ${cx - 8 * s} ${cy - 5 * s} L ${cx + 8 * s} ${cy - 5 * s}
    M ${cx - 8 * s} ${cy + 5 * s} L ${cx + 8 * s} ${cy + 5 * s}
  `;
  return (
    <Group>
      <Circle cx={cx} cy={cy} r={r} color={color} style="stroke" strokeWidth={stroke} />
      <Path path={meridian} color={color} style="stroke" strokeWidth={stroke * 0.85} />
      <Path path={latitudes} color={color} style="stroke" strokeWidth={stroke * 0.85} />
    </Group>
  );
}

// ── Settings — 8-tooth gear ────────────────────────────────────────────────
function SettingsIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  const cx = 14 * s;
  const cy = 14 * s;
  const innerR = 4 * s;
  const outerR = 7 * s;
  const toothLen = 3 * s;

  // 8 teeth at every 45°.
  const teeth: string[] = [];
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    const x1 = cx + Math.cos(angle) * outerR;
    const y1 = cy + Math.sin(angle) * outerR;
    const x2 = cx + Math.cos(angle) * (outerR + toothLen);
    const y2 = cy + Math.sin(angle) * (outerR + toothLen);
    teeth.push(`M ${x1} ${y1} L ${x2} ${y2}`);
  }

  return (
    <Group>
      {/* Outer ring */}
      <Circle cx={cx} cy={cy} r={outerR} color={color} style="stroke" strokeWidth={stroke} />
      {/* Center hub */}
      <Circle cx={cx} cy={cy} r={innerR} color={color} style="stroke" strokeWidth={stroke} />
      {/* Teeth — 8 short stems radiating outward */}
      {teeth.map((p, i) => (
        <Path key={i} path={p} color={color} style="stroke" strokeWidth={stroke * 1.4} strokeCap="round" />
      ))}
    </Group>
  );
}
