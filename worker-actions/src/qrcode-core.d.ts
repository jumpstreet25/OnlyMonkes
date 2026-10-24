// The qrcode package's encoder core (no Node file system needed); only what referrals.ts uses.
declare module "qrcode/lib/core/qrcode" {
  export function create(text: string, opts?: { errorCorrectionLevel?: "L" | "M" | "Q" | "H" }): {
    modules: { size: number; get(row: number, col: number): number | boolean };
  };
}
