import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { Client, PublicIdentity } from "@/web/xmtpCompat";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
function wallet(privHex: string) {
  const priv = Uint8Array.from(privHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const pub = secp256k1.getPublicKey(priv, false).slice(1);
  const address = "0x" + hex(keccak_256(pub).slice(-20));
  return {
    address,
    signer: {
      getIdentifier: async () => new PublicIdentity(address, "ETHEREUM"),
      signMessage: async (text: string) => {
        const msg = new TextEncoder().encode(text);
        const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${msg.length}`);
        const all = new Uint8Array(prefix.length + msg.length); all.set(prefix); all.set(msg, prefix.length);
        const sig = secp256k1.sign(keccak_256(all), priv);
        return { signature: "0x" + sig.toCompactHex() + (sig.recovery + 27).toString(16) };
      },
    },
  };
}
(globalThis as any).OM = { Client, PublicIdentity, wallet };
