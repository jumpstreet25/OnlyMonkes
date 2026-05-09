/**
 * BotAlertCard — structured-data renderer for the bot's "Top Sales" alerts.
 *
 * The bot ships these alerts as a single text blob with `✦ *Section*`
 * dividers (e.g. "Top Sales (24h)", "Volume Surges (24h vs prior)",
 * "Floor Drops (24h)"), inline numbered list items inside a section, and
 * an optional intro line. Rendered as a wall of carved text in the
 * Banana Grove bubble it's unreadable. This component:
 *
 *   1. Parses the alert into intro + sections (each: title + items|body).
 *   2. Renders Top Sales as a tight 3-column list (rank | name | price).
 *   3. Renders other sections as compact paragraphs with bold headers.
 *
 * Falls back to null if parsing fails — caller falls through to default
 * carved-text rendering.
 */
import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";

const TEXT_COLOR = "#F0DBB0";       // matches FRESH_CUT_FILL — readable on wood
const ACCENT_COLOR = "#FFE0A8";     // brighter cream for headers + prices
const BORDER_COLOR = "rgba(255, 224, 168, 0.28)";

interface SaleItem {
  rank: number;
  name: string;   // e.g. "Mad Lads #1792"
  price: string;  // e.g. "49.0 SOL"
}

interface ParsedAlert {
  intro: string | null;
  topSales: { title: string; items: SaleItem[] } | null;
  sections: Array<{ title: string; body: string }>;
}

/**
 * Parse the bot's alert text into structured pieces. Returns null if the
 * content doesn't look like a Top Sales alert (so caller can fall back).
 */
export function parseTopSalesAlert(content: string): ParsedAlert | null {
  if (!content || !/Top Sales/i.test(content)) return null;

  const parts = content.split(/✦/);
  // First part before any ✦ marker is the intro flavor text.
  const intro = parts[0]?.trim() || null;

  let topSales: ParsedAlert["topSales"] = null;
  const sections: ParsedAlert["sections"] = [];

  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i].trim();
    if (!seg) continue;
    // Section header looks like "*Title*"
    const headerMatch = seg.match(/^\*([^*]+)\*/);
    if (!headerMatch) continue;
    const title = headerMatch[1].trim();
    const body = seg.slice(headerMatch[0].length).trim();

    if (/top sales/i.test(title)) {
      // Items: "1. Name — price 2. Name — price ..."
      // Em-dash variants: — (U+2014), - (hyphen). Tolerate both.
      const re = /(\d+)\.\s*([^—\-]+?)\s*[—\-]\s*([\d.,]+\s*[A-Za-z]+)/g;
      const items: SaleItem[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(body)) !== null) {
        items.push({
          rank: parseInt(m[1], 10),
          name: m[2].trim(),
          price: m[3].trim(),
        });
      }
      if (items.length > 0) {
        topSales = { title, items };
      }
    } else {
      sections.push({ title, body });
    }
  }

  if (!topSales) return null;
  return { intro, topSales, sections };
}

interface Props {
  content: string;
}

export const BotAlertCard = React.memo(function BotAlertCard({ content }: Props) {
  const parsed = useMemo(() => parseTopSalesAlert(content), [content]);
  if (!parsed) return null;

  return (
    <View style={styles.root}>
      {parsed.intro ? (
        <Text style={styles.intro} selectable={false}>{parsed.intro}</Text>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle} selectable={false}>{parsed.topSales!.title}</Text>
        {parsed.topSales!.items.map((it) => (
          <View key={it.rank} style={styles.row}>
            <Text style={styles.rank} selectable={false}>{it.rank}</Text>
            <Text style={styles.name} numberOfLines={1} selectable={false}>{it.name}</Text>
            <Text style={styles.price} selectable={false}>{it.price}</Text>
          </View>
        ))}
      </View>

      {parsed.sections.map((sec, idx) => (
        <View key={idx} style={styles.section}>
          <Text style={styles.sectionTitle} selectable={false}>{sec.title}</Text>
          <Text style={styles.sectionBody} selectable={false}>{sec.body}</Text>
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    gap: 10,
  },
  intro: {
    color: TEXT_COLOR,
    fontSize: 13,
    fontStyle: "italic",
    opacity: 0.85,
  },
  card: {
    borderWidth: 1,
    borderColor: BORDER_COLOR,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  cardTitle: {
    color: ACCENT_COLOR,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 2,
  },
  rank: {
    color: TEXT_COLOR,
    fontSize: 12,
    fontWeight: "700",
    width: 22,
    opacity: 0.75,
  },
  name: {
    color: TEXT_COLOR,
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  price: {
    color: ACCENT_COLOR,
    fontSize: 13,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  section: {
    gap: 2,
  },
  sectionTitle: {
    color: ACCENT_COLOR,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  sectionBody: {
    color: TEXT_COLOR,
    fontSize: 13,
    lineHeight: 18,
  },
});
