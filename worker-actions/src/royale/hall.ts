/**
 * Jungle Royale lobby + matches, without any Cloudflare API so it can be tested
 * with fake sockets (royale.ts wraps it in the Durable Object).
 *
 * A match starts when 4 holders are waiting, or 12 s after the first one joined;
 * OnlyTreasury bots fill the empty seats. A holder who joins a running match
 * (under 4 min in) takes a bot's seat; one who leaves is played out by a bot.
 * The match code (match.js) decides movement limits, shots, hits and kills.
 * At the end, `onEarned` gets each holder still in the match and their bananas
 * (royale.ts credits them, capped per day).
 */
import { createMatch, matchBananas, VS, type Match } from "./match.js";
import { ARENAS } from "./arenas.js";

export interface Sock { send(data: string): void; close(code?: number, reason?: string): void }

interface Player {
  sock: Sock; wallet: string; n: number; id: string;
  room: Room | null; input: { x: number; y: number; a: number; aim?: number; fire?: boolean } | null;
  queuedAt: number;
}
interface Room { id: string; m: Match; players: Set<Player>; endedAt: number | null }

export const HALL = { FORM_MS: 12_000, LATE_JOIN_S: 240, KEEP_ENDED_MS: 30_000, MAX_ROOMS: 30, MAX_PLAYERS: 120 };

export class Hall {
  private queue: Player[] = [];
  private bySock = new Map<Sock, Player>();
  private rooms = new Map<string, Room>();
  private seq = 0;
  private lastWaitNote = 0;

  constructor(
    private now: () => number = () => Date.now(),
    private onEarned: (sock: Sock, wallet: string, bananas: number) => void = () => {},
  ) {}

  get playerCount() { return this.bySock.size; }
  get busy() { return this.queue.length > 0 || this.rooms.size > 0; }

  join(sock: Sock, wallet: string, n: number): void {
    // One seat per wallet: a second tab or a reconnect replaces the first.
    for (const p of this.bySock.values()) if (p.wallet === wallet) { this.leave(p.sock); p.sock.close(4000, "joined somewhere else"); }
    if (this.bySock.size >= HALL.MAX_PLAYERS) { send(sock, { t: "err", msg: "Jungle Royale is full, try again in a minute" }); sock.close(4001, "full"); return; }
    const p: Player = { sock, wallet, n, id: `p${++this.seq}`, room: null, input: null, queuedAt: this.now() };
    this.bySock.set(sock, p);
    this.seat(p);
  }

  // Into a running match (a bot's seat), else the queue.
  private seat(p: Player): void {
    for (const r of this.rooms.values()) {
      if (r.endedAt || r.m.time > HALL.LATE_JOIN_S || r.players.size >= VS.SEATS) continue;
      if (r.m.fighters.some((f) => f.n === p.n && !f.bot)) continue;
      if (!r.m.replaceBot({ id: p.id, n: p.n, name: `#${p.n}` })) continue;
      p.room = r; r.players.add(p);
      send(p.sock, this.startMsg(r, p));
      this.roster(r, p);
      return;
    }
    p.queuedAt = this.now();
    this.queue.push(p);
    this.noteWait(true);
  }

  input(sock: Sock, msg: any): void {
    const p = this.bySock.get(sock);
    if (!p?.room || p.room.endedAt) return;
    p.input = { x: +msg.x, y: +msg.y, a: +msg.a, aim: msg.aim == null ? undefined : +msg.aim, fire: !!msg.f };
  }

  again(sock: Sock): void {
    const p = this.bySock.get(sock);
    if (!p || (p.room && !p.room.endedAt) || this.queue.includes(p)) return;
    if (p.room) p.room.players.delete(p);
    p.room = null; p.input = null;
    this.seat(p);
  }

  leave(sock: Sock): void {
    const p = this.bySock.get(sock);
    if (!p) return;
    this.bySock.delete(sock);
    this.queue = this.queue.filter((q) => q !== p);
    if (p.room) {
      p.room.players.delete(p);
      if (!p.room.endedAt) { p.room.m.botify(p.id); this.roster(p.room); }
    }
  }

  tick(dt: number): void {
    const now = this.now();
    // Start a match: four waiting, or the first has waited long enough.
    if (this.queue.length && (this.queue.length >= VS.SEATS || now - this.queue[0].queuedAt >= HALL.FORM_MS) && this.rooms.size < HALL.MAX_ROOMS) {
      const group = this.queue.splice(0, VS.SEATS);
      const m = createMatch(ARENAS[0], { seed: (now & 0xffff) + this.seq });
      const r: Room = { id: `m${++this.seq}`, m, players: new Set(group), endedAt: null };
      for (const p of group) { p.room = r; p.input = null; m.addFighter({ id: p.id, n: p.n, name: `#${p.n}` }); }
      m.fillBots(VS.SEATS);
      this.rooms.set(r.id, r);
      for (const p of group) send(p.sock, this.startMsg(r, p));
    }
    this.noteWait(false);

    for (const r of [...this.rooms.values()]) {
      if (r.endedAt) { if (now - r.endedAt > HALL.KEEP_ENDED_MS || !r.players.size) this.rooms.delete(r.id); continue; }
      const human: Record<string, NonNullable<Player["input"]>> = {};
      for (const p of r.players) if (p.input) human[p.id] = p.input;
      const events = r.m.step(dt, human);
      const snap = r.m.snapshot();
      const ev = events.filter((e) => e.t !== "shot" || e.by);
      for (const p of r.players) {
        const f = r.m.fighters.find((x) => x.id === p.id);
        if (f?.fix) { f.fix = false; send(p.sock, { t: "fix", x: f.x, y: f.y }); }
        send(p.sock, { t: "s", ...snap, ammo: f?.ammo ?? 0, e: ev });
      }
      if (r.m.over) {
        r.endedAt = now;
        const standings = r.m.standings().map((f) => [f.id, f.n, f.name, f.bot ? 1 : 0, f.kills, f.deaths]);
        for (const p of r.players) {
          const bananas = matchBananas(r.m, p.id);
          send(p.sock, { t: "over", winner: r.m.winner, standings, bananas });
          if (bananas > 0) this.onEarned(p.sock, p.wallet, bananas);
        }
      }
    }
  }

  private startMsg(r: Room, p: Player) {
    return { t: "start", you: p.id, match: r.id, arena: 0, fighters: r.m.fighters.map((f) => ({ id: f.id, n: f.n, name: f.name, bot: f.bot })) };
  }

  // Who's in the match changed (a holder took a bot's seat, or left to a bot).
  private roster(r: Room, except?: Player): void {
    const fighters = this.startMsg(r, except ?? ({} as Player)).fighters;
    for (const q of r.players) if (q !== except) send(q.sock, { t: "roster", fighters });
  }

  // The waiting screen: how many are in, and when bots fill the rest.
  private noteWait(force: boolean): void {
    const now = this.now();
    if (!this.queue.length || (!force && now - this.lastWaitNote < 1000)) return;
    this.lastWaitNote = now;
    const startsIn = Math.max(0, Math.ceil((HALL.FORM_MS - (now - this.queue[0].queuedAt)) / 1000));
    for (const p of this.queue) send(p.sock, { t: "wait", holders: this.queue.length, startsIn });
  }
}

function send(sock: Sock, msg: unknown): void {
  try { sock.send(JSON.stringify(msg)); } catch { /* closed */ }
}
