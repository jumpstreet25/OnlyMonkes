import { Hall, HALL } from "../src/royale/hall";

function sock() {
  const msgs: any[] = [];
  return { msgs, closed: null as null | number, send(d: string) { msgs.push(JSON.parse(d)); }, close(c?: number) { this.closed = c ?? 1000; } };
}
const last = (s: ReturnType<typeof sock>, t: string) => [...s.msgs].reverse().find((m) => m.t === t);

describe("Jungle Royale hall", () => {
  let now = 0;
  const hall = () => new Hall(() => now);
  const run = (h: Hall, secs: number) => { for (let i = 0; i < secs * 20; i++) { now += 50; h.tick(0.05); } };

  beforeEach(() => { now = 1_000_000; });

  it("waits, then starts with bots filling the seats", () => {
    const h = hall(), a = sock(), b = sock();
    h.join(a, "walletA", 8982);
    h.join(b, "walletB", 1234);
    expect(last(a, "wait")).toMatchObject({ holders: 2 });
    run(h, HALL.FORM_MS / 1000 - 1);
    expect(last(a, "start")).toBeUndefined();
    run(h, 1.5);
    const start = last(a, "start");
    expect(start.fighters).toHaveLength(4);
    expect(start.fighters.filter((f: any) => f.bot)).toHaveLength(2);
    expect(last(a, "s").f).toHaveLength(4);
  });

  it("starts at once with four holders", () => {
    const h = hall(), s = [sock(), sock(), sock(), sock()];
    s.forEach((x, i) => h.join(x, `w${i}`, 100 + i));
    run(h, 0.1);
    expect(last(s[0], "start").fighters.filter((f: any) => !f.bot)).toHaveLength(4);
  });

  it("a late holder takes a bot's seat; a leaver is played by a bot", () => {
    const h = hall(), a = sock(), c = sock();
    h.join(a, "walletA", 8982);
    run(h, 13);
    h.join(c, "walletC", 4242);
    const start = last(c, "start");
    expect(start.fighters.filter((f: any) => !f.bot)).toHaveLength(2);
    expect(last(a, "roster").fighters.some((f: any) => f.n === 4242 && !f.bot)).toBe(true);
    h.leave(c);
    const r = last(a, "roster");
    expect(r.fighters.find((f: any) => f.n === 4242).bot).toBe(true);
  });

  it("refuses a teleport and tells the player where they are", () => {
    const h = hall(), a = sock();
    h.join(a, "walletA", 8982);
    run(h, 13);
    const me = last(a, "s").f.find((f: any) => f[0] === last(a, "start").you);
    h.input(a, { t: "in", x: me[1] + 5, y: me[2], a: 0 });
    run(h, 0.1);
    expect(last(a, "fix")).toMatchObject({ x: me[1], y: me[2] });
  });

  it("one seat per wallet", () => {
    const h = hall(), a = sock(), a2 = sock();
    h.join(a, "walletA", 8982);
    h.join(a2, "walletA", 8982);
    expect(a.closed).toBe(4000);
    expect(h.playerCount).toBe(1);
  });

  it("plays to the end and reports bananas", () => {
    const h = hall(), a = sock();
    h.join(a, "walletA", 8982);
    run(h, 13 + 300);
    const over = last(a, "over");
    expect(over).toBeTruthy();
    expect(over.standings).toHaveLength(4);
    expect(typeof over.bananas).toBe("number");
    h.again(a);
    expect(last(a, "wait")).toBeTruthy();
  });
});
