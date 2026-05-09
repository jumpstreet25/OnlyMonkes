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
  | "settings"
  // (v38 2026-05-09) ProfileScorecard / user card additions.
  // Banana stays brand-yellow regardless of world; caller passes color.
  | "flame"        // 🔥 streak
  | "star"         // ⭐ badges, 🌟 legendary
  | "cycles"       // 🔄 banana cycles
  | "shield"       // 🛡️ streak shield
  | "clipboard"    // 📋 copy wallet
  | "pin"          // 📍 location
  | "banana"      // 🍌 (caller passes #FFD24A or similar)
  | "cart"        // 🛒 shopping cart (Banana Shop button)
  | "search"      // 🔍 search bar magnifier
  // (v41 2026-05-09) Badge glyphs — replace emoji rendering for the badge
  // system across MessageBubble / ProfileScorecard / UserProfileModal /
  // BadgeNotificationBanner. Emoji→Skia map lives in BadgeGlyph.tsx.
  | "crown"       // 👑 messages_1000
  | "gem"         // 💎 streak_30 / diamond_hands
  | "trophy"      // 🏆 top_monke
  | "confetti"    // 🎉 reactions_50
  | "speech"      // 💬 messages_100 / chatterbox
  | "letter"      // ✉️ first_message
  | "monkeface"   // 🐒 og_monke
  | "chart_up"    // 📈 top_trader
  | "target"      // 🎯 sharp_shooter
  | "gift"        // 🎁 generous_ape
  | "bolt"        // ⚡ reaction_king
  | "clover"      // 🍀 lucky_monke
  | "palm"        // 🌴 og_jungle_king
  | "gorilla";    // 🦍 clout-flair suffix

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
      {name === "flame" && <FlameIcon s={s} color={color} />}
      {name === "star" && <StarIcon s={s} color={color} />}
      {name === "cycles" && <CyclesIcon s={s} color={color} />}
      {name === "shield" && <ShieldIcon s={s} color={color} />}
      {name === "clipboard" && <ClipboardIcon s={s} color={color} />}
      {name === "pin" && <PinIcon s={s} color={color} />}
      {name === "banana" && <BananaIcon s={s} color={color} />}
      {name === "cart" && <CartIcon s={s} color={color} />}
      {name === "search" && <SearchIcon s={s} color={color} />}
      {name === "crown" && <CrownIcon s={s} color={color} />}
      {name === "gem" && <GemIcon s={s} color={color} />}
      {name === "trophy" && <TrophyIcon s={s} color={color} />}
      {name === "confetti" && <ConfettiIcon s={s} color={color} />}
      {name === "speech" && <SpeechIcon s={s} color={color} />}
      {name === "letter" && <LetterIcon s={s} color={color} />}
      {name === "monkeface" && <MonkeFaceIcon s={s} color={color} />}
      {name === "chart_up" && <ChartUpIcon s={s} color={color} />}
      {name === "target" && <TargetIcon s={s} color={color} />}
      {name === "gift" && <GiftIcon s={s} color={color} />}
      {name === "bolt" && <BoltIcon s={s} color={color} />}
      {name === "clover" && <CloverIcon s={s} color={color} />}
      {name === "palm" && <PalmIcon s={s} color={color} />}
      {name === "gorilla" && <GorillaIcon s={s} color={color} />}
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

// ── Flame — streak fire ────────────────────────────────────────────────────
function FlameIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  // Outer flame teardrop — pointed top, rounded base. Inner ember curl
  // suggests heat. Asymmetric to feel hand-drawn.
  const flame = `
    M ${14 * s} ${3 * s}
    Q ${20 * s} ${10 * s} ${20 * s} ${15 * s}
    Q ${21 * s} ${20 * s} ${17 * s} ${22 * s}
    Q ${14 * s} ${24 * s} ${11 * s} ${22 * s}
    Q ${7 * s} ${20 * s} ${8 * s} ${15 * s}
    Q ${8 * s} ${11 * s} ${10 * s} ${9 * s}
    Q ${11 * s} ${12 * s} ${13 * s} ${10 * s}
    Q ${12 * s} ${6 * s} ${14 * s} ${3 * s}
    Z
  `;
  // Inner ember curl
  const inner = `
    M ${14 * s} ${14 * s}
    Q ${17 * s} ${17 * s} ${15 * s} ${20 * s}
    Q ${13 * s} ${21 * s} ${12 * s} ${18 * s}
    Q ${11 * s} ${15 * s} ${14 * s} ${14 * s}
    Z
  `;
  return (
    <Group>
      <Path path={flame} color={color} style="stroke" strokeWidth={stroke} strokeJoin="round" />
      <Path path={inner} color={color} />
    </Group>
  );
}

// ── Star — 5-point ─────────────────────────────────────────────────────────
function StarIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  // 5-point star: 10 alternating points (5 outer, 5 inner)
  const cx = 14 * s;
  const cy = 14 * s;
  const outerR = 10 * s;
  const innerR = 4.2 * s;
  const points: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI / 5) * i - Math.PI / 2; // start at top
    const r = i % 2 === 0 ? outerR : innerR;
    points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
  }
  let path = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length; i++) {
    path += ` L ${points[i][0]} ${points[i][1]}`;
  }
  path += " Z";
  return (
    <Path path={path} color={color} style="stroke" strokeWidth={stroke} strokeJoin="round" />
  );
}

// ── Cycles — circular arrow loop ───────────────────────────────────────────
function CyclesIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  const cx = 14 * s;
  const cy = 14 * s;
  const r = 8.5 * s;
  // Circular arc 270° (3/4 circle) leaving a gap at the top-right where
  // the arrowhead sits — classic refresh-cycle shape.
  // Start at top (12 o'clock), sweep clockwise 270° to right (3 o'clock).
  // Use SVG arc command. From (cx, cy-r) → (cx+r, cy) is 90°; instead we
  // want a full loop minus a small gap so we sweep ~280°.
  const startX = cx + Math.cos(-Math.PI / 2 + Math.PI / 6) * r;
  const startY = cy + Math.sin(-Math.PI / 2 + Math.PI / 6) * r;
  const endX = cx + Math.cos(-Math.PI / 2) * r;
  const endY = cy + Math.sin(-Math.PI / 2) * r;
  const arc = `M ${startX} ${startY} A ${r} ${r} 0 1 0 ${endX} ${endY}`;
  // Arrowhead at the top — small triangle pointing right
  const arrowSize = 3 * s;
  const ax = endX;
  const ay = endY;
  const head = `
    M ${ax - arrowSize * 0.6} ${ay - arrowSize * 0.6}
    L ${ax + arrowSize * 0.4} ${ay - arrowSize * 0.6}
    L ${ax + arrowSize * 0.1} ${ay + arrowSize * 0.4}
    Z
  `;
  return (
    <Group>
      <Path path={arc} color={color} style="stroke" strokeWidth={stroke * 1.2} strokeCap="round" />
      <Path path={head} color={color} />
    </Group>
  );
}

// ── Shield — streak protection ─────────────────────────────────────────────
function ShieldIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  // Heater-shield silhouette: rounded top, sides curving down to a point.
  const shield = `
    M ${14 * s} ${3 * s}
    Q ${22 * s} ${5 * s} ${22 * s} ${10 * s}
    Q ${22 * s} ${18 * s} ${14 * s} ${24 * s}
    Q ${6 * s} ${18 * s} ${6 * s} ${10 * s}
    Q ${6 * s} ${5 * s} ${14 * s} ${3 * s}
    Z
  `;
  // Center checkmark — small "✓" indicating active
  const check = `
    M ${10 * s} ${13 * s}
    L ${13 * s} ${16 * s}
    L ${18 * s} ${10 * s}
  `;
  return (
    <Group>
      <Path path={shield} color={color} style="stroke" strokeWidth={stroke} strokeJoin="round" />
      <Path path={check} color={color} style="stroke" strokeWidth={stroke * 1.3} strokeCap="round" strokeJoin="round" />
    </Group>
  );
}

// ── Clipboard — copy ───────────────────────────────────────────────────────
function ClipboardIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  const r = 1.3 * s;
  // Body + clip at top (small protrusion centered)
  return (
    <Group>
      <RoundedRect x={6 * s} y={5 * s} width={16 * s} height={20 * s} r={r} color={color} style="stroke" strokeWidth={stroke} />
      {/* Clip at top — small rounded rect overlapping body top */}
      <RoundedRect x={10 * s} y={3 * s} width={8 * s} height={5 * s} r={r * 0.8} color={color} style="stroke" strokeWidth={stroke} />
      {/* 3 lines suggesting text content */}
      <Path
        path={`M ${10 * s} ${13 * s} L ${18 * s} ${13 * s} M ${10 * s} ${17 * s} L ${18 * s} ${17 * s} M ${10 * s} ${21 * s} L ${15 * s} ${21 * s}`}
        color={color}
        style="stroke"
        strokeWidth={stroke * 0.8}
        strokeCap="round"
      />
    </Group>
  );
}

// ── Pin — location ─────────────────────────────────────────────────────────
function PinIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  // Map-pin teardrop: rounded top, narrows to a point at the bottom.
  const pin = `
    M ${14 * s} ${3 * s}
    Q ${22 * s} ${3 * s} ${22 * s} ${11 * s}
    Q ${22 * s} ${17 * s} ${14 * s} ${25 * s}
    Q ${6 * s} ${17 * s} ${6 * s} ${11 * s}
    Q ${6 * s} ${3 * s} ${14 * s} ${3 * s}
    Z
  `;
  return (
    <Group>
      <Path path={pin} color={color} style="stroke" strokeWidth={stroke} strokeJoin="round" />
      <Circle cx={14 * s} cy={11 * s} r={2.6 * s} color={color} />
    </Group>
  );
}

// ── Cart — Banana Shop button ──────────────────────────────────────────────
function CartIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  // Cart body — angled trapezoid (front taller than back to show 3D)
  const body = `
    M ${5 * s} ${10 * s}
    L ${22 * s} ${10 * s}
    L ${20 * s} ${19 * s}
    L ${8 * s} ${19 * s}
    Z
  `;
  // Handle — line from top-back of cart up to a small hook
  const handle = `M ${3 * s} ${6 * s} L ${7 * s} ${6 * s} L ${8 * s} ${10 * s}`;
  // Wheels
  return (
    <Group>
      <Path path={handle} color={color} style="stroke" strokeWidth={stroke} strokeCap="round" strokeJoin="round" />
      <Path path={body} color={color} style="stroke" strokeWidth={stroke} strokeJoin="round" />
      <Circle cx={10 * s} cy={22.5 * s} r={1.6 * s} color={color} style="stroke" strokeWidth={stroke} />
      <Circle cx={18 * s} cy={22.5 * s} r={1.6 * s} color={color} style="stroke" strokeWidth={stroke} />
    </Group>
  );
}

// ── Search — magnifier for search bar ─────────────────────────────────────
function SearchIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s * 1.15;
  // Lens circle at upper-left, handle from lower-right of lens to bottom-right.
  const cx = 12 * s;
  const cy = 12 * s;
  const r = 6 * s;
  // Handle starts just outside the circle on the lower-right diagonal.
  // Circle edge at 45°: cx + r*cos(45), cy + r*sin(45)
  const hx1 = cx + r * 0.707;
  const hy1 = cy + r * 0.707;
  const hx2 = 22 * s;
  const hy2 = 22 * s;
  const handle = `M ${hx1} ${hy1} L ${hx2} ${hy2}`;
  return (
    <Group>
      <Circle cx={cx} cy={cy} r={r} color={color} style="stroke" strokeWidth={stroke} />
      <Path path={handle} color={color} style="stroke" strokeWidth={stroke} strokeCap="round" />
    </Group>
  );
}

// ── Banana — brand glyph (caller passes banana yellow) ─────────────────────
function BananaIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  // Crescent banana shape with stem at top-right.
  // Outer curve: top-right (stem) → swooping down-left → bottom-left tip
  // Inner curve back along the inside.
  const banana = `
    M ${20 * s} ${5 * s}
    Q ${24 * s} ${10 * s} ${22 * s} ${17 * s}
    Q ${18 * s} ${24 * s} ${8 * s} ${24 * s}
    Q ${5 * s} ${24 * s} ${4 * s} ${22 * s}
    Q ${10 * s} ${22 * s} ${15 * s} ${18 * s}
    Q ${20 * s} ${13 * s} ${20 * s} ${5 * s}
    Z
  `;
  // Small stem nub at top-right
  const stem = `M ${20 * s} ${5 * s} L ${21 * s} ${3 * s}`;
  return (
    <Group>
      <Path path={banana} color={color} />
      <Path path={banana} color="rgba(0,0,0,0.35)" style="stroke" strokeWidth={stroke * 0.8} strokeJoin="round" />
      <Path path={stem} color="rgba(0,0,0,0.5)" style="stroke" strokeWidth={stroke * 1.4} strokeCap="round" />
    </Group>
  );
}

// ── Crown — 👑 messages_1000 ───────────────────────────────────────────────
function CrownIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  // Three peaks + base. Five points outline: bl → up to peak1 → down to v1 →
  // up to peak2 (taller) → down to v2 → up to peak3 → br → bl.
  const crown = `
    M ${4 * s} ${20 * s}
    L ${6 * s} ${9 * s}
    L ${10 * s} ${14 * s}
    L ${14 * s} ${6 * s}
    L ${18 * s} ${14 * s}
    L ${22 * s} ${9 * s}
    L ${24 * s} ${20 * s}
    Z
  `;
  return (
    <Group>
      <Path path={crown} color={color} style="stroke" strokeWidth={stroke} strokeJoin="round" />
      <Circle cx={6 * s} cy={9 * s} r={1.4 * s} color={color} />
      <Circle cx={14 * s} cy={6 * s} r={1.6 * s} color={color} />
      <Circle cx={22 * s} cy={9 * s} r={1.4 * s} color={color} />
      <Path path={`M ${4 * s} ${22 * s} L ${24 * s} ${22 * s}`} color={color} style="stroke" strokeWidth={stroke} strokeCap="round" />
    </Group>
  );
}

// ── Gem — 💎 streak_30 / diamond_hands ─────────────────────────────────────
function GemIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  // Classic faceted diamond: top trapezoid + V point.
  const outline = `
    M ${8 * s} ${10 * s}
    L ${14 * s} ${4 * s}
    L ${20 * s} ${10 * s}
    L ${14 * s} ${24 * s}
    Z
  `;
  // Inner facet lines
  const facet1 = `M ${8 * s} ${10 * s} L ${20 * s} ${10 * s}`;
  const facet2 = `M ${11 * s} ${10 * s} L ${14 * s} ${4 * s}`;
  const facet3 = `M ${17 * s} ${10 * s} L ${14 * s} ${4 * s}`;
  const facet4 = `M ${11 * s} ${10 * s} L ${14 * s} ${24 * s}`;
  const facet5 = `M ${17 * s} ${10 * s} L ${14 * s} ${24 * s}`;
  return (
    <Group>
      <Path path={outline} color={color} style="stroke" strokeWidth={stroke} strokeJoin="round" />
      <Path path={facet1} color={color} style="stroke" strokeWidth={stroke * 0.7} />
      <Path path={facet2} color={color} style="stroke" strokeWidth={stroke * 0.7} />
      <Path path={facet3} color={color} style="stroke" strokeWidth={stroke * 0.7} />
      <Path path={facet4} color={color} style="stroke" strokeWidth={stroke * 0.7} />
      <Path path={facet5} color={color} style="stroke" strokeWidth={stroke * 0.7} />
    </Group>
  );
}

// ── Trophy — 🏆 top_monke ──────────────────────────────────────────────────
function TrophyIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  // Cup body + side handles + stem + base.
  const cup = `
    M ${8 * s} ${5 * s}
    L ${20 * s} ${5 * s}
    L ${19 * s} ${14 * s}
    Q ${14 * s} ${17 * s} ${9 * s} ${14 * s}
    Z
  `;
  // Left handle
  const handleL = `M ${8 * s} ${7 * s} Q ${4 * s} ${8 * s} ${5 * s} ${12 * s} Q ${6 * s} ${13 * s} ${8.5 * s} ${13 * s}`;
  // Right handle
  const handleR = `M ${20 * s} ${7 * s} Q ${24 * s} ${8 * s} ${23 * s} ${12 * s} Q ${22 * s} ${13 * s} ${19.5 * s} ${13 * s}`;
  // Stem + base
  const stem = `M ${14 * s} ${17 * s} L ${14 * s} ${21 * s}`;
  const base = `M ${9 * s} ${21 * s} L ${19 * s} ${21 * s}`;
  return (
    <Group>
      <Path path={cup} color={color} style="stroke" strokeWidth={stroke} strokeJoin="round" />
      <Path path={handleL} color={color} style="stroke" strokeWidth={stroke} strokeCap="round" />
      <Path path={handleR} color={color} style="stroke" strokeWidth={stroke} strokeCap="round" />
      <Path path={stem} color={color} style="stroke" strokeWidth={stroke} strokeCap="round" />
      <Path path={base} color={color} style="stroke" strokeWidth={stroke * 1.2} strokeCap="round" />
    </Group>
  );
}

// ── Confetti — 🎉 reactions_50 ─────────────────────────────────────────────
function ConfettiIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  // Cone (party popper) + flying confetti dots.
  const cone = `
    M ${5 * s} ${24 * s}
    L ${11 * s} ${10 * s}
    L ${17 * s} ${16 * s}
    Z
  `;
  return (
    <Group>
      <Path path={cone} color={color} style="stroke" strokeWidth={stroke} strokeJoin="round" />
      <Circle cx={19 * s} cy={6 * s} r={1.4 * s} color={color} />
      <Circle cx={23 * s} cy={10 * s} r={1.2 * s} color={color} />
      <Circle cx={22 * s} cy={16 * s} r={1.2 * s} color={color} />
      <Circle cx={15 * s} cy={5 * s} r={1.2 * s} color={color} />
      <Path path={`M ${20 * s} ${20 * s} L ${24 * s} ${22 * s}`} color={color} style="stroke" strokeWidth={stroke * 0.8} strokeCap="round" />
    </Group>
  );
}

// ── Speech — 💬 messages_100 / chatterbox ──────────────────────────────────
function SpeechIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  return (
    <Group>
      <RoundedRect x={4 * s} y={5 * s} width={20 * s} height={14 * s} r={4 * s} color={color} style="stroke" strokeWidth={stroke} />
      {/* Tail */}
      <Path path={`M ${10 * s} ${19 * s} L ${8 * s} ${24 * s} L ${14 * s} ${19 * s}`} color={color} style="stroke" strokeWidth={stroke} strokeJoin="round" />
      {/* Three dots inside */}
      <Circle cx={10 * s} cy={12 * s} r={1.2 * s} color={color} />
      <Circle cx={14 * s} cy={12 * s} r={1.2 * s} color={color} />
      <Circle cx={18 * s} cy={12 * s} r={1.2 * s} color={color} />
    </Group>
  );
}

// ── Letter — ✉️ first_message ──────────────────────────────────────────────
function LetterIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  return (
    <Group>
      <RoundedRect x={4 * s} y={7 * s} width={20 * s} height={14 * s} r={1.5 * s} color={color} style="stroke" strokeWidth={stroke} />
      {/* Envelope flap V */}
      <Path path={`M ${4 * s} ${8 * s} L ${14 * s} ${15 * s} L ${24 * s} ${8 * s}`} color={color} style="stroke" strokeWidth={stroke} strokeJoin="round" strokeCap="round" />
    </Group>
  );
}

// ── MonkeFace — 🐒 og_monke ────────────────────────────────────────────────
function MonkeFaceIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  return (
    <Group>
      {/* Outer head circle */}
      <Circle cx={14 * s} cy={14 * s} r={9 * s} color={color} style="stroke" strokeWidth={stroke} />
      {/* Two ears */}
      <Circle cx={5.5 * s} cy={11 * s} r={2.5 * s} color={color} style="stroke" strokeWidth={stroke} />
      <Circle cx={22.5 * s} cy={11 * s} r={2.5 * s} color={color} style="stroke" strokeWidth={stroke} />
      {/* Inner face oval (muzzle) */}
      <Path path={`M ${9 * s} ${17 * s} Q ${14 * s} ${22 * s} ${19 * s} ${17 * s}`} color={color} style="stroke" strokeWidth={stroke * 0.85} strokeCap="round" />
      {/* Eyes */}
      <Circle cx={11 * s} cy={13 * s} r={1.1 * s} color={color} />
      <Circle cx={17 * s} cy={13 * s} r={1.1 * s} color={color} />
    </Group>
  );
}

// ── ChartUp — 📈 top_trader ────────────────────────────────────────────────
function ChartUpIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  // Axes + ascending zig-zag with arrow head.
  const axes = `M ${4 * s} ${4 * s} L ${4 * s} ${24 * s} L ${24 * s} ${24 * s}`;
  const line = `M ${6 * s} ${20 * s} L ${11 * s} ${15 * s} L ${15 * s} ${17 * s} L ${22 * s} ${8 * s}`;
  // Arrow head at upper right
  const arrow = `M ${22 * s} ${8 * s} L ${17 * s} ${8 * s} M ${22 * s} ${8 * s} L ${22 * s} ${13 * s}`;
  return (
    <Group>
      <Path path={axes} color={color} style="stroke" strokeWidth={stroke} strokeCap="round" strokeJoin="round" />
      <Path path={line} color={color} style="stroke" strokeWidth={stroke * 1.1} strokeCap="round" strokeJoin="round" />
      <Path path={arrow} color={color} style="stroke" strokeWidth={stroke} strokeCap="round" />
    </Group>
  );
}

// ── Target — 🎯 sharp_shooter ──────────────────────────────────────────────
function TargetIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  return (
    <Group>
      <Circle cx={14 * s} cy={14 * s} r={10 * s} color={color} style="stroke" strokeWidth={stroke} />
      <Circle cx={14 * s} cy={14 * s} r={6.5 * s} color={color} style="stroke" strokeWidth={stroke * 0.85} />
      <Circle cx={14 * s} cy={14 * s} r={3 * s} color={color} style="stroke" strokeWidth={stroke * 0.7} />
      <Circle cx={14 * s} cy={14 * s} r={1.2 * s} color={color} />
    </Group>
  );
}

// ── Gift — 🎁 generous_ape ─────────────────────────────────────────────────
function GiftIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  return (
    <Group>
      {/* Box body */}
      <RoundedRect x={4 * s} y={11 * s} width={20 * s} height={13 * s} r={1 * s} color={color} style="stroke" strokeWidth={stroke} />
      {/* Vertical ribbon */}
      <Path path={`M ${14 * s} ${11 * s} L ${14 * s} ${24 * s}`} color={color} style="stroke" strokeWidth={stroke} />
      {/* Horizontal ribbon (cap) */}
      <Path path={`M ${4 * s} ${11 * s} L ${24 * s} ${11 * s}`} color={color} style="stroke" strokeWidth={stroke} />
      {/* Bow loops */}
      <Circle cx={10 * s} cy={8 * s} r={3 * s} color={color} style="stroke" strokeWidth={stroke} />
      <Circle cx={18 * s} cy={8 * s} r={3 * s} color={color} style="stroke" strokeWidth={stroke} />
    </Group>
  );
}

// ── Bolt — ⚡ reaction_king ─────────────────────────────────────────────────
function BoltIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  const bolt = `
    M ${15 * s} ${3 * s}
    L ${7 * s} ${15 * s}
    L ${13 * s} ${15 * s}
    L ${11 * s} ${25 * s}
    L ${21 * s} ${12 * s}
    L ${15 * s} ${12 * s}
    Z
  `;
  return <Path path={bolt} color={color} style="stroke" strokeWidth={stroke} strokeJoin="round" />;
}

// ── Clover — 🍀 lucky_monke ────────────────────────────────────────────────
function CloverIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  // Four heart-leaves centered around (14, 13).
  return (
    <Group>
      <Circle cx={14 * s} cy={7 * s} r={4 * s} color={color} style="stroke" strokeWidth={stroke} />
      <Circle cx={14 * s} cy={19 * s} r={4 * s} color={color} style="stroke" strokeWidth={stroke} />
      <Circle cx={8 * s} cy={13 * s} r={4 * s} color={color} style="stroke" strokeWidth={stroke} />
      <Circle cx={20 * s} cy={13 * s} r={4 * s} color={color} style="stroke" strokeWidth={stroke} />
      {/* Stem */}
      <Path path={`M ${14 * s} ${21 * s} Q ${17 * s} ${24 * s} ${18 * s} ${26 * s}`} color={color} style="stroke" strokeWidth={stroke * 0.8} strokeCap="round" />
    </Group>
  );
}

// ── Palm — 🌴 og_jungle_king ───────────────────────────────────────────────
function PalmIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  // Trunk with two slight curves
  const trunk = `M ${14 * s} ${10 * s} Q ${13 * s} ${17 * s} ${15 * s} ${24 * s}`;
  // Five fronds radiating from top
  return (
    <Group>
      <Path path={trunk} color={color} style="stroke" strokeWidth={stroke * 1.4} strokeCap="round" />
      {/* Fronds */}
      <Path path={`M ${14 * s} ${9 * s} Q ${8 * s} ${5 * s} ${3 * s} ${7 * s}`} color={color} style="stroke" strokeWidth={stroke} strokeCap="round" />
      <Path path={`M ${14 * s} ${9 * s} Q ${20 * s} ${5 * s} ${25 * s} ${7 * s}`} color={color} style="stroke" strokeWidth={stroke} strokeCap="round" />
      <Path path={`M ${14 * s} ${9 * s} Q ${10 * s} ${3 * s} ${5 * s} ${2 * s}`} color={color} style="stroke" strokeWidth={stroke} strokeCap="round" />
      <Path path={`M ${14 * s} ${9 * s} Q ${18 * s} ${3 * s} ${23 * s} ${2 * s}`} color={color} style="stroke" strokeWidth={stroke} strokeCap="round" />
      <Path path={`M ${14 * s} ${9 * s} L ${14 * s} ${2 * s}`} color={color} style="stroke" strokeWidth={stroke} strokeCap="round" />
      {/* Coconut */}
      <Circle cx={11 * s} cy={11 * s} r={1.2 * s} color={color} />
    </Group>
  );
}

// ── Gorilla — 🦍 clout flair ───────────────────────────────────────────────
function GorillaIcon({ s, color }: { s: number; color: string }) {
  const stroke = STROKE * s;
  // Bulkier-than-monkey shape: wide head, brow ridge, no ears.
  return (
    <Group>
      {/* Wider head */}
      <Path
        path={`M ${5 * s} ${14 * s} Q ${5 * s} ${5 * s} ${14 * s} ${5 * s} Q ${23 * s} ${5 * s} ${23 * s} ${14 * s} Q ${23 * s} ${22 * s} ${14 * s} ${23 * s} Q ${5 * s} ${22 * s} ${5 * s} ${14 * s} Z`}
        color={color}
        style="stroke"
        strokeWidth={stroke}
        strokeJoin="round"
      />
      {/* Brow ridge */}
      <Path path={`M ${8 * s} ${11 * s} Q ${14 * s} ${9 * s} ${20 * s} ${11 * s}`} color={color} style="stroke" strokeWidth={stroke} strokeCap="round" />
      {/* Eyes */}
      <Circle cx={11 * s} cy={13 * s} r={1.1 * s} color={color} />
      <Circle cx={17 * s} cy={13 * s} r={1.1 * s} color={color} />
      {/* Frown */}
      <Path path={`M ${11 * s} ${19 * s} Q ${14 * s} ${17 * s} ${17 * s} ${19 * s}`} color={color} style="stroke" strokeWidth={stroke * 0.85} strokeCap="round" />
    </Group>
  );
}
