// Web stand-in for freerasp-react-native: no runtime app self-protection in a
// browser. Web is a lower-trust tier; sensitive actions are still signed in
// the user's own wallet.
export function useFreeRasp(_config: unknown, _actions: unknown): void {}
export type TalsecConfig = Record<string, unknown>;
export type ThreatEventActions = Record<string, () => void>;
