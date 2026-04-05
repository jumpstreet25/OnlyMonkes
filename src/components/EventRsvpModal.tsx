/**
 * EventRsvpModal — Premium event detail + RSVP modal.
 * Shows event info with a "Going?" prompt and attendee count.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, Pressable, Modal, Image,
} from "react-native";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { THEME, FONTS } from "@/lib/constants";
import { useAppStore } from "@/store/appStore";
import {
  isGoing, rsvpGoing, rsvpNotGoing, getAttendeeCount, getAttendees,
  buildRsvpMessage, loadRsvps,
} from "@/lib/eventRsvp";
import { getCachedProfile, getAllTimeUsers } from "@/lib/userProfile";
import type { CalendarEvent } from "@/store/appStore";
import type { LumaEvent } from "@/lib/lumaEvents";

interface EventRsvpModalProps {
  visible: boolean;
  event: LumaEvent | CalendarEvent | null;
  onClose: () => void;
  onSendRsvp?: (message: string) => void; // sends RSVP to XMTP group
}

function isLuma(e: any): e is LumaEvent {
  return e?.source === "luma";
}

function getEventId(e: LumaEvent | CalendarEvent): string {
  return isLuma(e) ? e.id : (e as CalendarEvent).id;
}

function getEventTitle(e: LumaEvent | CalendarEvent): string {
  return isLuma(e) ? e.name : (e as CalendarEvent).title;
}

function getEventDate(e: LumaEvent | CalendarEvent): string {
  if (isLuma(e)) {
    const d = new Date(e.startAt);
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
      + " at " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  const cal = e as CalendarEvent;
  return `${cal.date}${cal.time ? " at " + cal.time : ""}`;
}

function getEventLocation(e: LumaEvent | CalendarEvent): string {
  return isLuma(e) ? e.location : (e as CalendarEvent).location;
}

export function EventRsvpModal({ visible, event, onClose, onSendRsvp }: EventRsvpModalProps) {
  const myInboxId = useAppStore(s => s.myInboxId);
  const [going, setGoing] = useState(false);
  const [count, setCount] = useState(0);
  const [attendeeNames, setAttendeeNames] = useState<string[]>([]);

  useEffect(() => {
    if (!event || !myInboxId) return;
    loadRsvps().then(() => {
      const eid = getEventId(event);
      setGoing(isGoing(eid, myInboxId));
      setCount(getAttendeeCount(eid));
      // Get attendee names
      const allUsers = getAllTimeUsers();
      const names = getAttendees(eid)
        .map(id => allUsers.get(id) ?? id.slice(0, 6))
        .slice(0, 8);
      setAttendeeNames(names);
    });
  }, [event, myInboxId, visible]);

  const handleRsvp = useCallback(async (yes: boolean) => {
    if (!event || !myInboxId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const eid = getEventId(event);

    if (yes) {
      await rsvpGoing(eid, myInboxId);
    } else {
      await rsvpNotGoing(eid, myInboxId);
    }
    setGoing(yes);
    setCount(getAttendeeCount(eid));

    // Broadcast to group
    if (onSendRsvp) {
      onSendRsvp(buildRsvpMessage(eid, yes, myInboxId));
    }
  }, [event, myInboxId, onSendRsvp]);

  if (!event) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <LinearGradient
            colors={["rgba(124,58,237,0.12)", "rgba(10,10,15,0)", "rgba(108,180,238,0.06)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />

          {/* Header accent line */}
          <View style={styles.accentLine} />

          <Text style={styles.title}>{getEventTitle(event)}</Text>

          <View style={styles.infoRow}>
            <Text style={styles.infoIcon}>📅</Text>
            <Text style={styles.infoText}>{getEventDate(event)}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoIcon}>📍</Text>
            <Text style={styles.infoText}>{getEventLocation(event)}</Text>
          </View>

          {!isLuma(event) && (event as CalendarEvent).purpose ? (
            <View style={styles.infoRow}>
              <Text style={styles.infoIcon}>📝</Text>
              <Text style={styles.infoText}>{(event as CalendarEvent).purpose}</Text>
            </View>
          ) : null}

          {/* Attendee count */}
          <View style={styles.attendeeSection}>
            <View style={styles.attendeePill}>
              <Text style={styles.attendeeEmoji}>🐒</Text>
              <Text style={styles.attendeeCount}>
                {count} {count === 1 ? "Monke" : "Monkes"} going
              </Text>
            </View>
            {attendeeNames.length > 0 && (
              <Text style={styles.attendeeList}>
                {attendeeNames.join(", ")}{count > 8 ? ` +${count - 8} more` : ""}
              </Text>
            )}
          </View>

          {/* RSVP section */}
          <View style={styles.rsvpSection}>
            <Text style={styles.rsvpQuestion}>Going?</Text>
            <View style={styles.rsvpButtons}>
              <Pressable
                style={[styles.rsvpBtn, styles.rsvpYes, going && styles.rsvpActive]}
                onPress={() => handleRsvp(true)}
              >
                <Text style={[styles.rsvpBtnText, going && styles.rsvpBtnTextActive]}>
                  {going ? "Going ✓" : "Yes"}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.rsvpBtn, styles.rsvpNo, !going && count > 0 ? null : null]}
                onPress={() => { handleRsvp(false); onClose(); }}
              >
                <Text style={styles.rsvpBtnText}>Not this time</Text>
              </Pressable>
            </View>
          </View>

          {/* Lu.ma link */}
          {isLuma(event) && event.url && (
            <Pressable
              style={styles.lumaLink}
              onPress={() => {
                const { Linking } = require("react-native");
                Linking.openURL(event.url).catch(() => {});
              }}
            >
              <Text style={styles.lumaLinkText}>View on Lu.ma →</Text>
            </Pressable>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center", alignItems: "center", padding: 24,
  },
  card: {
    backgroundColor: "rgba(18,18,26,0.97)", borderRadius: 24, padding: 28,
    borderWidth: 1, borderColor: "rgba(124,58,237,0.2)",
    shadowColor: "#7C3AED", shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25, shadowRadius: 24, elevation: 12,
    alignSelf: "stretch", maxWidth: 380, overflow: "hidden", gap: 14,
  },
  accentLine: {
    position: "absolute", top: 0, left: 40, right: 40, height: 3,
    borderRadius: 2, backgroundColor: "#7C3AED",
  },
  title: {
    fontFamily: FONTS.display, fontSize: 22, color: THEME.text,
    marginTop: 4,
  },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  infoIcon: { fontSize: 16, marginTop: 1 },
  infoText: { fontFamily: FONTS.body, fontSize: 14, color: THEME.textMuted, flex: 1, lineHeight: 20 },
  attendeeSection: {
    backgroundColor: "rgba(124,58,237,0.06)", borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: "rgba(124,58,237,0.1)",
  },
  attendeePill: {
    flexDirection: "row", alignItems: "center", gap: 8,
  },
  attendeeEmoji: { fontSize: 18 },
  attendeeCount: { fontFamily: FONTS.display, fontSize: 16, color: THEME.text },
  attendeeList: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textMuted, marginTop: 6 },
  rsvpSection: { alignItems: "center", gap: 12, marginTop: 4 },
  rsvpQuestion: { fontFamily: FONTS.display, fontSize: 18, color: THEME.text },
  rsvpButtons: { flexDirection: "row", gap: 12, width: "100%" },
  rsvpBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: "center",
    borderWidth: 1.5,
  },
  rsvpYes: {
    borderColor: "rgba(16,185,129,0.3)", backgroundColor: "rgba(16,185,129,0.08)",
  },
  rsvpNo: {
    borderColor: THEME.border, backgroundColor: "rgba(255,255,255,0.03)",
  },
  rsvpActive: {
    borderColor: "#10B981", backgroundColor: "rgba(16,185,129,0.18)",
  },
  rsvpBtnText: { fontFamily: FONTS.bodySemi, fontSize: 15, color: THEME.textMuted },
  rsvpBtnTextActive: { color: "#10B981" },
  lumaLink: {
    alignItems: "center", paddingVertical: 8,
  },
  lumaLinkText: { fontFamily: FONTS.bodySemi, fontSize: 13, color: "#6CB4EE" },
});
