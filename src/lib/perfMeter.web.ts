/**
 * Web speed meter: open the site with ?perf=1 (or #perf) and a small panel
 * shows the longest freezes on this page and what caused them, so slowness on
 * a real account can be measured instead of guessed. Only the viewer sees it;
 * nothing is sent anywhere. "Copy" puts the report on the clipboard.
 *
 * Uses Long Animation Frames (Chrome 123+: script URL + function per frame)
 * and falls back to Long Tasks elsewhere; a 100 ms timer catches freezes that
 * neither reports.
 */

type Freeze = { at: number; ms: number; what: string };

const shortUrl = (u: string) => (u || "").replace(location.origin, "").replace(/^.*\/(?=[^/]+$)/, "").replace(/-[0-9a-f]{12,}/, "").slice(0, 40);

export function startPerfMeterIfAsked(): void {
  if (typeof window === "undefined") return;
  const asked = /[?&]perf=1\b/.test(location.search) || location.hash === "#perf";
  try {
    if (asked) sessionStorage.setItem("om_perf", "1");
    if (!asked && sessionStorage.getItem("om_perf") !== "1") return;
  } catch {
    if (!asked) return;
  }
  if ((window as any).__omPerf) return;
  (window as any).__omPerf = true;

  const t0 = performance.now();
  // Count WebGL contexts made: every Skia canvas makes one on the web.
  let glMade = 0;
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  (HTMLCanvasElement.prototype as any).getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
    if (/webgl/.test(type)) glMade++;
    return (origGetContext as any).call(this, type, ...rest);
  };
  const freezes: Freeze[] = [];
  let blocked = 0, count = 0, worstGap = 0;
  const add = (f: Freeze) => {
    count++;
    blocked += f.ms;
    freezes.push(f);
    freezes.sort((a, b) => b.ms - a.ms);
    if (freezes.length > 8) freezes.length = 8;
  };

  const types = (PerformanceObserver as any).supportedEntryTypes ?? [];
  if (types.includes("long-animation-frame")) {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as any[]) {
        if (e.duration < 200) continue;
        const scripts = [...(e.scripts ?? [])] as any[];
        const top = scripts.sort((a, b) => b.duration - a.duration)[0];
        const js = Math.round(scripts.reduce((a, s) => a + s.duration, 0));
        const forced = Math.round(scripts.reduce((a, s) => a + (s.forcedStyleAndLayoutDuration || 0), 0));
        const layout = Math.round(e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0);
        const split = `js ${js} (forced layout ${forced}) · style/layout/paint ${layout}`;
        const what = top
          ? `${top.invokerType ?? ""} ${top.sourceFunctionName || top.invoker || ""} @${shortUrl(top.sourceURL)}:${top.sourceCharPosition ?? "?"} · ${split}`.trim()
          : split;
        add({ at: e.startTime, ms: Math.round(e.duration), what });
      }
    }).observe({ type: "long-animation-frame", buffered: true });
  } else if (types.includes("longtask")) {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.duration >= 200) add({ at: e.startTime, ms: Math.round(e.duration), what: "long task" });
    }).observe({ type: "longtask", buffered: true });
  }

  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    worstGap = Math.max(worstGap, now - last - 100);
    last = now;
  }, 100);

  const panel = document.createElement("div");
  panel.setAttribute("style", [
    "position:fixed", "right:8px", "bottom:8px", "z-index:2147483647", "width:340px", "max-width:calc(100vw - 16px)",
    "max-height:50vh", "overflow:auto", "background:rgba(10,10,15,0.92)", "color:#ededf3", "border:1px solid rgba(255,255,255,0.18)",
    "border-radius:10px", "padding:10px", "font:11px/1.4 ui-monospace,monospace", "white-space:pre-wrap",
  ].join(";"));
  const text = document.createElement("div");
  const bar = document.createElement("div");
  bar.setAttribute("style", "display:flex;gap:6px;margin-top:8px");
  const btn = (label: string, onClick: () => void) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.setAttribute("style", "font:inherit;color:#fff;background:#e91671;border:0;border-radius:6px;padding:4px 10px;cursor:pointer");
    b.onclick = onClick;
    bar.appendChild(b);
    return b;
  };

  const report = () => {
    const res = (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
      .filter((r) => r.transferSize > 200_000 || r.encodedBodySize > 1_000_000)
      .sort((a, b) => b.encodedBodySize - a.encodedBodySize).slice(0, 5)
      .map((r) => `  ${shortUrl(r.name)} ${Math.round(r.encodedBodySize / 1024)}KB${r.transferSize === 0 ? " (cache)" : ""} ${Math.round(r.duration)}ms`);
    const mem = (performance as any).memory;
    return [
      `OnlyMonkes speed · ${Math.round((performance.now() - t0) / 1000)}s on page · ${location.pathname}`,
      `freezes ≥200ms: ${count} · total ${Math.round(blocked / 1000 * 10) / 10}s · worst timer gap ${Math.round(worstGap)}ms`,
      mem ? `JS heap ${Math.round(mem.usedJSHeapSize / 1048576)}MB` : "",
      `WebGL contexts made ${glMade} · canvases now ${document.getElementsByTagName("canvas").length} · page elements ${document.getElementsByTagName("*").length}`,
      "longest:",
      ...freezes.map((f) => `  ${f.ms}ms @${Math.round(f.at / 1000)}s ${f.what}`),
      res.length ? "biggest downloads:" : "",
      ...res,
    ].filter(Boolean).join("\n");
  };

  btn("Copy", () => {
    navigator.clipboard?.writeText(report()).catch(() => {});
  });
  btn("Reset", () => { freezes.length = 0; blocked = 0; count = 0; worstGap = 0; });
  btn("Hide", () => { panel.remove(); try { sessionStorage.removeItem("om_perf"); } catch { /* ignore */ } });
  panel.append(text, bar);
  const mount = () => document.body ? document.body.appendChild(panel) : setTimeout(mount, 200);
  mount();
  setInterval(() => { text.textContent = report(); }, 1000);
}
