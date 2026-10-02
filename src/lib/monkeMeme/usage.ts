/**
 * usage — per-device daily MonkeMeme counter (AsyncStorage). Keeps one
 * holder from burning through their ZeroGPU allowance in a loop and gives
 * the screen an honest "N left today". Resets at local midnight.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "monkememe_usage_v1";

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

async function read(): Promise<{ day: string; count: number }> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : null;
    if (v && v.day === today() && typeof v.count === "number") return v;
  } catch {
    // fall through
  }
  return { day: today(), count: 0 };
}

export async function getUsedToday(): Promise<number> {
  return (await read()).count;
}

export async function recordGeneration(): Promise<number> {
  const v = await read();
  const next = { day: v.day, count: v.count + 1 };
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // non-fatal — worst case the limit is a little generous
  }
  return next.count;
}
