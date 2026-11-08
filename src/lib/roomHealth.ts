/**
 * Avatar Room health report: one Sentry info event per session (≥30 s) so a
 * "breaking up" report can be told apart — network (packet loss / jitter on
 * your own mic, as the server sees it) or a phone too busy to keep up (JS
 * event-loop lag, 3D stage frame rate). Also records how much of each other
 * member's audio this phone had to fill in (concealment) — that is what
 * "they were breaking up" sounds like from the listener's side.
 *
 * Numbers only: no inbox IDs or wallets, members are listed by display name.
 */
import { Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { RoomEvent, type Room, type Participant } from 'livekit-client';
import { Sentry } from './sentry';

const SAMPLE_MS = 5_000;
const LAG_TICK_MS = 250;
const MIN_SESSION_MS = 30_000;

interface Running {
  room: Room;
  startedAt: number;
  timers: ReturnType<typeof setInterval>[];
  off: () => void;
  // own mic, deltas between samples
  lastSent: number; lastLost: number; sent: number; lost: number;
  lossSamples: number[]; jitterMs: number[]; rttMs: number[];
  // what this phone heard from others (per display name)
  heard: Map<string, { lastRecv: number; lastConc: number; recvSamples: number; concSamples: number; lost: number; lastLost: number }>;
  // phone load
  lagMs: number[]; lastTick: number;
  stageFps: number[]; stageDpr: number[];
  // events
  reconnects: number; poorQuality: number; qualityChanges: number;
  stage3dMs: number; stage3dSince: number | null; faceOn: boolean; krisp: boolean;
}

let _run: Running | null = null;

export function startRoomHealth(room: Room, opts: { krisp: boolean }): void {
  stopRoomHealth(false);
  const r: Running = {
    room, startedAt: Date.now(), timers: [], off: () => {},
    lastSent: 0, lastLost: 0, sent: 0, lost: 0, lossSamples: [], jitterMs: [], rttMs: [],
    heard: new Map(), lagMs: [], lastTick: Date.now(), stageFps: [], stageDpr: [],
    reconnects: 0, poorQuality: 0, qualityChanges: 0,
    stage3dMs: 0, stage3dSince: null, faceOn: true, krisp: opts.krisp,
  };
  const onReconnect = () => { r.reconnects++; };
  const onQuality = (q: string, p: Participant) => {
    if (p?.identity !== room.localParticipant?.identity) return;
    r.qualityChanges++;
    if (q === 'poor' || q === 'lost') r.poorQuality++;
  };
  room.on(RoomEvent.Reconnecting, onReconnect);
  room.on(RoomEvent.ConnectionQualityChanged, onQuality as any);
  r.off = () => {
    room.off(RoomEvent.Reconnecting, onReconnect);
    room.off(RoomEvent.ConnectionQualityChanged, onQuality as any);
  };
  // Event-loop lag: how late a 250 ms timer fires. A phone that can't keep up shows here first.
  r.timers.push(setInterval(() => {
    const now = Date.now();
    r.lagMs.push(Math.max(0, now - r.lastTick - LAG_TICK_MS));
    r.lastTick = now;
    if (r.lagMs.length > 4800) r.lagMs.splice(0, 2400);
  }, LAG_TICK_MS));
  r.timers.push(setInterval(() => { sample(r).catch(() => {}); }, SAMPLE_MS));
  _run = r;
}

async function sample(r: Running): Promise<void> {
  const mic: any = r.room.localParticipant?.getTrackPublication('microphone' as any)?.track;
  const s = await mic?.getSenderStats?.();
  if (s) {
    const sent = s.packetsSent ?? 0, lost = s.packetsLost ?? 0;
    const dSent = sent - r.lastSent, dLost = lost - r.lastLost;
    if (r.lastSent > 0 && dSent > 0) {
      r.sent += dSent; r.lost += Math.max(0, dLost);
      r.lossSamples.push(Math.max(0, dLost) / (dSent + Math.max(0, dLost)));
    }
    r.lastSent = sent; r.lastLost = lost;
    if (s.jitter != null) r.jitterMs.push(s.jitter * 1000);
    if (s.roundTripTime != null) r.rttMs.push(s.roundTripTime * 1000);
  }
  for (const p of r.room.remoteParticipants.values()) {
    for (const pub of p.trackPublications.values()) {
      const t: any = pub.track;
      if (pub.kind !== 'audio' || !t?.getReceiverStats) continue;
      const rs = await t.getReceiverStats().catch(() => undefined);
      if (!rs) continue;
      const name = (p.name || 'Monke').slice(0, 24);
      const h = r.heard.get(name) ?? { lastRecv: 0, lastConc: 0, recvSamples: 0, concSamples: 0, lost: 0, lastLost: 0 };
      // concealedSamples / totalSamplesDuration (seconds of audio) → share of audio filled in.
      const total = rs.totalSamplesDuration ?? 0, conc = rs.concealedSamples ?? 0, pl = rs.packetsLost ?? 0;
      if (h.lastRecv > 0 && total > h.lastRecv) {
        h.recvSamples += (total - h.lastRecv) * 48_000; // Opus decodes at 48 kHz
        h.concSamples += Math.max(0, conc - h.lastConc);
        h.lost += Math.max(0, pl - h.lastLost);
      }
      h.lastRecv = total; h.lastConc = conc; h.lastLost = pl;
      r.heard.set(name, h);
    }
  }
}

/** Screen state that matters for load: 3D stage on/off, face camera on/off. */
export function noteRoomView(view: { stage3d: boolean; face: boolean }): void {
  const r = _run;
  if (!r) return;
  const now = Date.now();
  if (view.stage3d && r.stage3dSince == null) r.stage3dSince = now;
  if (!view.stage3d && r.stage3dSince != null) { r.stage3dMs += now - r.stage3dSince; r.stage3dSince = null; }
  r.faceOn = view.face;
}

/** Frame rate / pixel ratio the 3D page reports (public/viewer/room.html "perf"). */
export function noteStagePerf(fps: number, dpr: number): void {
  if (!_run || !Number.isFinite(fps) || !Number.isFinite(dpr)) return;
  _run.stageFps.push(Math.max(0, Math.min(240, fps)));
  _run.stageDpr.push(Math.max(0.25, Math.min(4, dpr)));
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10;
};
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

/** Ends the watch; sends the report when `send` and the session lasted ≥30 s. */
export function stopRoomHealth(send = true): void {
  const r = _run;
  if (!r) return;
  _run = null;
  r.timers.forEach(clearInterval);
  r.off();
  const durationMs = Date.now() - r.startedAt;
  if (!send || durationMs < MIN_SESSION_MS) return;
  if (r.stage3dSince != null) r.stage3dMs += Date.now() - r.stage3dSince;

  const micLossPct = r.sent ? Math.round((r.lost / (r.sent + r.lost)) * 1000) / 10 : null;
  const micLossWorstPct = r.lossSamples.length ? Math.round(Math.max(...r.lossSamples) * 1000) / 10 : null;
  const lagP95 = pct(r.lagMs, 0.95);
  const lagBadPct = r.lagMs.length ? Math.round((r.lagMs.filter(x => x > 100).length / r.lagMs.length) * 1000) / 10 : null;
  const heard = [...r.heard.entries()].map(([name, h]) => ({
    name,
    concealedPct: h.recvSamples ? Math.round((h.concSamples / h.recvSamples) * 1000) / 10 : null,
    packetsLost: h.lost,
  }));
  // Rough verdict; the raw numbers are in the report.
  const netBad = (micLossPct ?? 0) >= 3 || (micLossWorstPct ?? 0) >= 10 || (pct(r.jitterMs, 0.95) ?? 0) >= 60;
  const phoneBad = (lagP95 ?? 0) >= 120 || (lagBadPct ?? 0) >= 5;
  const verdict = netBad && phoneBad ? 'both' : netBad ? 'network' : phoneBad ? 'phone' : 'ok';

  NetInfo.fetch().catch(() => null).then((net) => {
    const extra = {
      durationS: Math.round(durationMs / 1000),
      micLossPct, micLossWorstPct,
      jitterMsP50: pct(r.jitterMs, 0.5), jitterMsP95: pct(r.jitterMs, 0.95),
      rttMsP50: pct(r.rttMs, 0.5), rttMsP95: pct(r.rttMs, 0.95),
      lagMsP50: pct(r.lagMs, 0.5), lagMsP95: pct(r.lagMs, 0.95), lagMsMax: pct(r.lagMs, 1), lagOver100msPct: lagBadPct,
      stageFpsAvg: avg(r.stageFps), stageFpsMin: r.stageFps.length ? Math.min(...r.stageFps) : null,
      stageDprLast: r.stageDpr.length ? r.stageDpr[r.stageDpr.length - 1] : null,
      stage3dPct: Math.round((r.stage3dMs / durationMs) * 100),
      faceTracking: r.faceOn, krisp: r.krisp,
      reconnects: r.reconnects, poorQualityEvents: r.poorQuality, qualityChanges: r.qualityChanges,
      members: r.room.remoteParticipants.size + 1,
      heard,
      netType: net?.type ?? null,
      netGen: (net?.details as any)?.cellularGeneration ?? null,
      wifiStrength: (net?.details as any)?.strength ?? null,
    };
    Sentry.withScope((scope) => {
      scope.setLevel('info');
      scope.setTag('area', 'avatarRoomHealth');
      scope.setTag('roomVerdict', verdict);
      scope.setTag('roomStage', r.stage3dMs > durationMs / 2 ? '3d' : '2d');
      scope.setTag('netType', String(extra.netType));
      scope.setTag('platform', Platform.OS);
      scope.setExtras(extra);
      Sentry.captureMessage(`Avatar Room health: ${verdict}`);
    });
  });
}
