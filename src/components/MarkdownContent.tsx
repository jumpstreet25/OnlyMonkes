/**
 * MarkdownContent — renders markdown as styled native Views/Text
 *
 * Uses react-native-marked's useMarkdown hook (NOT the FlatList-based component)
 * so it can safely nest inside FlashList/ScrollView chat bubbles.
 *
 * Styled to match OnlyMonkes THEME (dark glass bubbles, white text, accent headers).
 */

import React, { useMemo } from "react";
import { View, type TextStyle } from "react-native";
import { useMarkdown } from "react-native-marked";
import type { MarkedStyles } from "react-native-marked";
import { THEME, FONTS } from "@/lib/constants";

interface MarkdownContentProps {
  content: string;
  style?: TextStyle;
}

const mdStyles: MarkedStyles = {
  text: {
    fontSize: 15,
    lineHeight: 22,
    color: THEME.text,
    fontFamily: FONTS.body,
  },
  strong: {
    fontSize: 15,
    lineHeight: 22,
    color: THEME.text,
    fontWeight: "bold",
    fontFamily: FONTS.bodyMed,
  },
  em: {
    fontSize: 15,
    lineHeight: 22,
    color: THEME.text,
    fontStyle: "italic",
    fontFamily: FONTS.body,
  },
  strikethrough: {
    fontSize: 15,
    lineHeight: 22,
    color: THEME.textDim,
    textDecorationLine: "line-through",
    textDecorationStyle: "solid",
  },
  link: {
    fontSize: 15,
    lineHeight: 22,
    color: THEME.accent,
    textDecorationLine: "underline",
    fontFamily: FONTS.body,
  },
  h1: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "bold",
    color: THEME.accent,
    fontFamily: FONTS.display,
    marginVertical: 4,
    paddingBottom: 0,
    borderBottomWidth: 0,
  },
  h2: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: "bold",
    color: THEME.accent,
    fontFamily: FONTS.display,
    marginVertical: 3,
    paddingBottom: 0,
    borderBottomWidth: 0,
  },
  h3: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "bold",
    color: THEME.accent,
    fontFamily: FONTS.displayMed,
    marginVertical: 2,
  },
  h4: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "bold",
    color: THEME.accent,
    fontFamily: FONTS.displayMed,
    marginVertical: 2,
  },
  h5: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "500",
    color: THEME.accent,
    fontFamily: FONTS.displayMed,
    marginVertical: 1,
  },
  h6: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
    color: THEME.accent,
    fontFamily: FONTS.displayMed,
    marginVertical: 1,
  },
  codespan: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: FONTS.mono,
    backgroundColor: "rgba(255,255,255,0.08)",
    color: THEME.text,
    fontWeight: "400",
  },
  code: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 8,
    padding: 10,
    minWidth: "100%" as any,
  },
  paragraph: {
    paddingVertical: 2,
  },
  blockquote: {
    borderLeftColor: THEME.accent,
    borderLeftWidth: 3,
    paddingLeft: 10,
    opacity: 0.85,
  },
  hr: {
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.12)",
    marginVertical: 4,
  },
  li: {
    fontSize: 15,
    lineHeight: 22,
    color: THEME.text,
    fontFamily: FONTS.body,
    flexShrink: 1,
  },
  list: {
    paddingLeft: 4,
  },
  table: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  tableRow: {
    flexDirection: "row",
  },
  tableCell: {
    padding: 4,
  },
};

const mdTheme = {
  colors: {
    code: "rgba(255,255,255,0.06)",
    link: THEME.accent,
    text: THEME.text,
    border: "rgba(255,255,255,0.12)",
  },
};

function MarkdownContent({ content, style }: MarkdownContentProps) {
  const mergedStyles = useMemo(() => {
    if (!style) return mdStyles;
    // Merge textScale / font overrides into text-level styles
    return {
      ...mdStyles,
      text: { ...mdStyles.text, ...style },
      strong: { ...mdStyles.strong, ...style, fontWeight: "bold" as const },
      em: { ...mdStyles.em, ...style, fontStyle: "italic" as const },
      li: { ...mdStyles.li, ...style },
      link: { ...mdStyles.link, ...style, color: THEME.accent, textDecorationLine: "underline" as const },
    };
  }, [style]);

  const elements = useMarkdown(content, {
    colorScheme: "dark",
    theme: mdTheme,
    styles: mergedStyles,
  });

  if (!elements || elements.length === 0) return null;

  return (
    <View style={{ gap: 0 }}>
      {elements}
    </View>
  );
}

export default React.memo(MarkdownContent);
