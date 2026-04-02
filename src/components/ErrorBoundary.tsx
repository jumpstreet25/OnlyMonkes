import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { THEME, FONTS } from "@/lib/constants";

interface Props {
  children: React.ReactNode;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (__DEV__) console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.emoji}>🐒</Text>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>
            {this.props.fallbackMessage ?? "The app hit an unexpected error. Try restarting."}
          </Text>
          <Pressable
            style={styles.button}
            onPress={() => this.setState({ hasError: false, error: null })}
          >
            <Text style={styles.buttonText}>Try Again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  emoji: { fontSize: 48, marginBottom: 16 },
  title: {
    color: THEME.text,
    fontSize: 20,
    fontFamily: FONTS.bodySemi,
    marginBottom: 8,
  },
  message: {
    color: THEME.textDim,
    fontSize: 14,
    fontFamily: FONTS.body,
    textAlign: "center",
    marginBottom: 24,
  },
  button: {
    backgroundColor: "rgba(153, 69, 255, 0.2)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(153, 69, 255, 0.4)",
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  buttonText: {
    color: "#9945FF",
    fontFamily: FONTS.bodySemi,
    fontSize: 14,
  },
});
