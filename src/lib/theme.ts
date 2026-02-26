import AsyncStorage from "@react-native-async-storage/async-storage";

export interface ChatTheme {
  id: string;
  name: string;
  emoji: string;
  ownBubble: string;    // background of own message bubble
  ownText: string;      // text color in own bubble
  accentColor: string;  // replaces purple accent in the UI
}

export const CHAT_THEMES: ChatTheme[] = [
  {
    id: "default",
    name: "Monke Dark",
    emoji: "🐒",
    ownBubble: "#1D8CF5",
    ownText: "#FFFFFF",
    accentColor: "#7C3AED",
  },
  {
    id: "ocean",
    name: "Ocean",
    emoji: "🌊",
    ownBubble: "#0077B6",
    ownText: "#FFFFFF",
    accentColor: "#0096C7",
  },
  {
    id: "forest",
    name: "Forest",
    emoji: "🌲",
    ownBubble: "#2D6A4F",
    ownText: "#FFFFFF",
    accentColor: "#40916C",
  },
  {
    id: "sunset",
    name: "Sunset",
    emoji: "🌅",
    ownBubble: "#E76F51",
    ownText: "#FFFFFF",
    accentColor: "#F4A261",
  },
  {
    id: "candy",
    name: "Candy",
    emoji: "🍬",
    ownBubble: "#E040FB",
    ownText: "#FFFFFF",
    accentColor: "#CE93D8",
  },
  {
    id: "cosmic",
    name: "Cosmic",
    emoji: "🚀",
    ownBubble: "#4A00E0",
    ownText: "#FFFFFF",
    accentColor: "#8E2DE2",
  },
  {
    id: "midnight",
    name: "Midnight",
    emoji: "🌙",
    ownBubble: "#2C2C54",
    ownText: "#E0E0FF",
    accentColor: "#7B7FC4",
  },
  {
    id: "gold",
    name: "Gold",
    emoji: "🏆",
    ownBubble: "#B8860B",
    ownText: "#FFFFFF",
    accentColor: "#FFD700",
  },
];

const AK_THEME_ID = "chat_theme_id";
const AK_CUSTOM_COLOR = "chat_theme_custom_color";

export async function loadThemeId(): Promise<string> {
  return (await AsyncStorage.getItem(AK_THEME_ID)) ?? "default";
}

export async function saveThemeId(id: string): Promise<void> {
  await AsyncStorage.setItem(AK_THEME_ID, id);
}

export async function loadCustomColor(): Promise<string | null> {
  return AsyncStorage.getItem(AK_CUSTOM_COLOR);
}

export async function saveCustomColor(hex: string): Promise<void> {
  await AsyncStorage.setItem(AK_CUSTOM_COLOR, hex);
}

export function getThemeById(id: string): ChatTheme {
  return CHAT_THEMES.find((t) => t.id === id) ?? CHAT_THEMES[0];
}
