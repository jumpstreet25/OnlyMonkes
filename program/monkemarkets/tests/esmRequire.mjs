// Plain ESM helper, deliberately outside ts-node/tsconfig's CommonJS
// compilation target. `import.meta` is only valid as literal syntax inside
// a real ES module file — it cannot be constructed dynamically (via
// `eval`/`new Function`, both of which parse their string argument as a
// Script, not a Module) from a `.ts` file compiled with
// `"module": "commonjs"`. This tiny file exists solely to hand back a
// working `require()` when the test suite happens to be loaded as native
// ESM by mocha/ts-node (see tests/monkemarkets.ts for why that varies).
import { createRequire } from "module";

export function makeRequire() {
  return createRequire(import.meta.url);
}
