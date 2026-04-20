import { Buffer } from 'buffer';
import process from 'process';
import { TextDecoder, TextEncoder } from 'text-encoding';

// Polyfills required for Solana web3.js, XMTP, and LiveKit in React Native / Hermes
global.Buffer = Buffer;
global.process = process;

// DOMException polyfill — XMTP SDK v5.7+ uses it; Hermes doesn't provide it
if (typeof globalThis.DOMException === 'undefined') {
  class DOMException extends Error {
    code: number;
    constructor(message?: string, name?: string) {
      super(message);
      this.name = name ?? 'DOMException';
      this.code = 0;
    }
  }
  (globalThis as any).DOMException = DOMException;
}

if (typeof global.TextDecoder === 'undefined') {
  (global as any).TextDecoder = TextDecoder;
}
if (typeof global.TextEncoder === 'undefined') {
  (global as any).TextEncoder = TextEncoder;
}
