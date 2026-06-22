// Node-global shims for browser-side web3 libs. Privy's embedded-wallet signing
// path (eth_signTypedData / order signing) uses Node's `Buffer`, which Vite does
// NOT polyfill by default → "ReferenceError: Buffer is not defined" on sign.
// Import this FIRST in main.tsx, before Privy loads.
import { Buffer } from "buffer";

const g = globalThis as unknown as { Buffer?: typeof Buffer; global?: typeof globalThis };
if (typeof g.Buffer === "undefined") g.Buffer = Buffer;
if (typeof g.global === "undefined") g.global = globalThis;
