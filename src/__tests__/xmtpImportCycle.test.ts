// 3.1 splash crash (2026-11-18): xmtpCredential → livekitProof → useMobileWallet → xmtp.ts → xmtpSdk
// → xmtpCredential was an import loop. At app start xmtp.ts ran before xmtpSdk finished, so its
// `new ReactionCodec()` threw. tsc and the unit tests can't see that, so this walks the real imports.
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const EXTS = ["", ".ts", ".tsx", ".js", "/index.ts", "/index.tsx"];

function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const e of EXTS) if (fs.existsSync(base + e) && fs.statSync(base + e).isFile()) return base + e;
  return null;
}

function staticImports(file: string): string[] {
  const src = fs.readFileSync(file, "utf8");
  const out: string[] = [];
  const re = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const r = resolve(file, m[1]);
    if (r) out.push(r);
  }
  return out;
}

/** Can `start` reach itself through static imports? Returns the loop, or null. */
function loopFrom(start: string): string[] | null {
  const seen = new Set<string>();
  const walk = (f: string, trail: string[]): string[] | null => {
    for (const d of staticImports(f)) {
      if (d === start) return [...trail, d];
      if (seen.has(d)) continue;
      seen.add(d);
      const r = walk(d, [...trail, d]);
      if (r) return r;
    }
    return null;
  };
  return walk(start, [start]);
}

describe("XMTP module import loops", () => {
  for (const f of ["src/lib/xmtpSdk.ts", "src/lib/xmtp.ts", "src/lib/xmtpCredential.ts"]) {
    it(`${f} does not import itself back`, () => {
      const loop = loopFrom(path.join(ROOT, f));
      expect(loop && loop.map((p) => path.relative(ROOT, p)).join(" → ")).toBeNull();
    });
  }
});
