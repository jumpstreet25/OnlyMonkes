import React, { Suspense, useEffect } from "react";
import { View, Text, ActivityIndicator, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAppStore } from "../src/store/appStore";
import { THEME, FONTS } from "../src/lib/constants";

const BotChannelScreen = React.lazy(() => import("../src/screens/BotChannelScreen"));

const Loading = () => (
  <View style={{ flex: 1, backgroundColor: THEME.bg, alignItems: 'center', justifyContent: 'center' }}>
    <ActivityIndicator size="large" color={THEME.accent} />
  </View>
);

// Error boundary to catch render crashes in bot channels
class BotChannelErrorBoundary extends React.Component<
  { children: React.ReactNode; onBack: () => void },
  { hasError: boolean; error: string }
> {
  state = { hasError: false, error: "" };
  static getDerivedStateFromError(err: Error) {
    return { hasError: true, error: err?.message ?? "Unknown error" };
  }
  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, backgroundColor: THEME.bg, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
          <Text style={{ fontFamily: FONTS.displayMed, fontSize: 18, color: THEME.text, marginBottom: 8 }}>
            Channel failed to load
          </Text>
          <Text style={{ fontFamily: FONTS.body, fontSize: 13, color: THEME.textMuted, textAlign: 'center', marginBottom: 20 }}>
            {this.state.error}
          </Text>
          <Pressable
            onPress={this.props.onBack}
            style={{ backgroundColor: THEME.accent, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 }}
          >
            <Text style={{ fontFamily: FONTS.bodyMed, fontSize: 14, color: '#fff' }}>Go Back</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function BotChannelRoute() {
  const router = useRouter();
  const { channelId } = useLocalSearchParams<{ channelId: string }>();
  const { verified, wallet } = useAppStore();

  useEffect(() => {
    if (!wallet) router.replace("/");
    else if (!verified) router.replace("/verify");
  }, [verified, wallet]);

  const validIds = ["trades"] as const;
  if (!wallet || !verified || !channelId || !validIds.includes(channelId as any)) return null;

  return (
    <BotChannelErrorBoundary onBack={() => router.back()}>
      <Suspense fallback={<Loading />}>
        <BotChannelScreen channelId={channelId as "trades"} />
      </Suspense>
    </BotChannelErrorBoundary>
  );
}
