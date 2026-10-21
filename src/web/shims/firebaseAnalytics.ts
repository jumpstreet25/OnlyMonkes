// Web stand-in for @react-native-firebase/analytics (native-only).
const noop = async () => {};
const instance = new Proxy({}, { get: () => noop });
export default function analytics() { return instance; }
export const getAnalytics = () => instance;
export const logEvent = noop;
