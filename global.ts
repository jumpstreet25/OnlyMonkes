import { Buffer } from 'buffer';
import process from 'process';

// Polyfills required for Solana web3.js and XMTP in React Native
global.Buffer = Buffer;
global.process = process;
