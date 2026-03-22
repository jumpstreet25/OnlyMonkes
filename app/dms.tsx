import React, { Suspense } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { THEME, FONTS } from '@/lib/constants';

const DmInboxScreen = React.lazy(() => import('@/screens/DmInboxScreen'));

class DmsErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  constructor(props: any) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(e: any) {
    return { error: String(e?.message ?? e) };
  }
  componentDidCatch(e: any, info: any) {
    console.error('[DmsRoute] crash:', e?.message, info?.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, backgroundColor: THEME.bg, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <Text style={{ fontFamily: FONTS.display, fontSize: 18, color: THEME.text, marginBottom: 12 }}>
            Messages unavailable
          </Text>
          <Text style={{ fontFamily: FONTS.body, fontSize: 13, color: THEME.textMuted, textAlign: 'center', marginBottom: 24 }}>
            {this.state.error}
          </Text>
          <Text
            style={{ fontFamily: FONTS.bodyMed, fontSize: 14, color: THEME.accent }}
            onPress={() => { this.setState({ error: null }); router.back(); }}
          >
            ← Go back
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const Loading = () => (
  <View style={{ flex: 1, backgroundColor: THEME.bg, alignItems: 'center', justifyContent: 'center' }}>
    <ActivityIndicator size="large" color={THEME.accent} />
  </View>
);

export default function DmsRoute() {
  return (
    <DmsErrorBoundary>
      <Suspense fallback={<Loading />}>
        <DmInboxScreen />
      </Suspense>
    </DmsErrorBoundary>
  );
}
