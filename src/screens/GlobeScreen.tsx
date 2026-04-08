/**
 * GlobeScreen — 3D interactive globe via WebView (Three.js in embedded browser).
 *
 * Renders a textured earth with:
 *  - User PFP markers at their set locations (purple)
 *  - Solana/Solana Mobile/Solflare/Saga Monkes events from Lu.ma (blue)
 *  - IRL events from the app's calendar (green)
 *  - Tap markers → profile modal or event detail modal
 *  - OrbitControls (rotate, zoom, pan disabled)
 *  - Total user count
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Image,
  ActivityIndicator,
  Modal,
  ScrollView,
  StatusBar,
  Linking,
} from "react-native";
import { WebView } from "react-native-webview";
import { router } from "expo-router";
// date-fns format removed — event formatting moved to EventRsvpModal
import { THEME, FONTS } from "@/lib/constants";
import { useAppStore } from "@/store/appStore";
import { getAllTimeUsers, getCachedProfile, useProfileVersion } from "@/lib/userProfile";
import { geocodeLocation, getCachedGeodata } from "@/lib/geocode";
import { fetchSolanaEvents, type LumaEvent } from "@/lib/lumaEvents";
import type { CalendarEvent } from "@/store/appStore";
import type { ProfileTarget } from "@/components/UserProfileModal";
import { EventRsvpModal } from "@/components/EventRsvpModal";
import { getAttendeeCount } from "@/lib/eventRsvp";

// ─── Types ───────────────────────────────────────────────────────────────────

interface GlobeMarker {
  id: string;
  lat: number;
  lng: number;
  type: "user" | "luma-event" | "irl-event";
  label: string;
  inboxId?: string;
  username?: string;
  nftImage?: string | null;
  event?: LumaEvent | CalendarEvent;
}

// ─── Globe HTML (Three.js rendered in WebView) ──────────────────────────────

// Globe HTML loaded from static asset file — avoids Hermes template literal escaping issues
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system";

let _cachedGlobeHtml: string | null = null;

async function loadGlobeHtml(): Promise<string> {
  if (_cachedGlobeHtml) return _cachedGlobeHtml;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const asset = Asset.fromModule(require("../../assets/globe.html"));
    await asset.downloadAsync();
    const uri = asset.localUri ?? asset.uri;
    const html = await FileSystem.readAsStringAsync(uri);
    _cachedGlobeHtml = html;
    return html;
  } catch {
    return "<html><body style='background:#0A0A0F;color:#6CB4EE;padding:40px;font:16px sans-serif'>Globe failed to load. Check assets/globe.html</body></html>";
  }
}

// Keep the old function signature for compatibility but it now returns a placeholder
function buildGlobeHtml(): string {
  return _cachedGlobeHtml ?? "<html><body style='background:#0A0A0F;color:#6CB4EE;padding:40px;font:16px sans-serif'>Loading globe...</body></html>";
}

// Old template literal removed — see assets/globe.html
const _DEAD = "";
// Dead template removed

// ─── Component ───────────────────────────────────────────────────────────────

interface GlobeScreenProps {
  onPressUser?: (target: ProfileTarget) => void;
  onSendRsvp?: (message: string) => void;
}

export default function GlobeScreen({ onPressUser, onSendRsvp }: GlobeScreenProps) {
  const calendarEvents = useAppStore(s => s.calendarEvents);
  const profileVersion = useProfileVersion(); // Re-run when any profile cache changes
  const [loading, setLoading] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState("");
  const [markers, setMarkers] = useState<GlobeMarker[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<LumaEvent | CalendarEvent | null>(null);
  const [clusterUsers, setClusterUsers] = useState<GlobeMarker[]>([]);
  const [onlineEvents, setOnlineEvents] = useState<LumaEvent[]>([]); // Events without location
  const webViewRef = useRef<WebView>(null);

  // ── Load markers (users + events) ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function load() {
      const allMarkers: GlobeMarker[] = [];
      const uncachedUserLocs: { inboxId: string; username: string; profile: any; location: string }[] = [];
      const seenInboxIds = new Set<string>();

      // 0. Always include own location from Zustand (most reliable source)
      const { myInboxId, username: myUsername, verifiedNft, location: myLocation } = useAppStore.getState();
      const cachedGeo = await getCachedGeodata();

      if (myInboxId && myLocation) {
        seenInboxIds.add(myInboxId);
        const key = myLocation.trim().toLowerCase();
        const cached = cachedGeo[key];
        if (cached) {
          allMarkers.push({
            id: `user-${myInboxId}`, lat: cached.lat, lng: cached.lng,
            type: "user", label: myUsername ?? "You", inboxId: myInboxId,
            username: myUsername ?? "You", nftImage: verifiedNft?.image ?? null,
          });
        } else {
          uncachedUserLocs.push({
            inboxId: myInboxId, username: myUsername ?? "You",
            profile: { nftImage: verifiedNft?.image ?? null },
            location: myLocation,
          });
        }
      }

      // 1. Other user locations from profile cache (deduped by wallet)
      const { getDeduplicatedUsers } = await import("@/lib/userProfile");
      const allUsers = getDeduplicatedUsers();

      for (const [inboxId, username] of allUsers.entries()) {
        if (seenInboxIds.has(inboxId)) continue; // skip self (already added)
        seenInboxIds.add(inboxId);
        const profile = getCachedProfile(inboxId);
        if (!profile?.location) continue;
        const key = profile.location.trim().toLowerCase();
        const cached = cachedGeo[key];

        if (cached) {
          allMarkers.push({
            id: `user-${inboxId}`, lat: cached.lat, lng: cached.lng,
            type: "user", label: username, inboxId, username, nftImage: profile.nftImage,
          });
        } else {
          uncachedUserLocs.push({ inboxId, username, profile, location: profile.location });
        }
      }

      // Show whatever cached markers we have immediately
      if (!cancelled) {
        if (allMarkers.length > 0) setMarkers([...allMarkers]);
        setLoading(false);
        if (uncachedUserLocs.length > 0) setLoadingStatus(`Locating ${uncachedUserLocs.length} Monkes...`);
      }

      // 2. Lu.ma Solana events
      const _onlineEvts: LumaEvent[] = [];
      try {
        const lumaEvents = await fetchSolanaEvents();
        for (const evt of lumaEvents) {
          if (cancelled) return;
          let lat = evt.lat;
          let lng = evt.lng;
          if (lat == null || lng == null) {
            // Try geocoding if location is a real place (not "Online" / "Solana Event")
            if (evt.location && evt.location !== "Online" && evt.location !== "Solana Event") {
              const coords = await geocodeLocation(evt.location);
              if (coords) { lat = coords.lat; lng = coords.lng; }
            }
          }
          if (lat != null && lng != null) {
            allMarkers.push({
              id: `luma-${evt.id}`, lat, lng,
              type: "luma-event", label: evt.name, event: evt,
            });
          } else {
            // No location — show in the online/unlocated events list
            _onlineEvts.push(evt);
          }
        }
      } catch { /* non-fatal */ }
      if (!cancelled) setOnlineEvents(_onlineEvts);

      // 3. IRL events from app calendar (only future events — remove after date passes)
      const now = Date.now();
      for (const evt of calendarEvents) {
        if (cancelled) return;
        if (!evt.location || evt.location === "OnlyMonkes") continue;
        // Parse "MM/DD/YYYY" + "HH:MM" — skip events that have ended (start + 2h buffer)
        const [mm, dd, yyyy] = (evt.date ?? "").split("/").map(Number);
        if (mm && dd && yyyy) {
          const [hh, min] = (evt.time ?? "").split(":").map(Number);
          const eventStart = new Date(yyyy, mm - 1, dd, hh || 23, min || 59, 0).getTime();
          const eventEnd = (hh || hh === 0) ? eventStart + 2 * 3600000 : eventStart;
          if (eventEnd < now) continue;
        }
        const coords = await geocodeLocation(evt.location);
        if (!coords) continue;
        allMarkers.push({
          id: `irl-${evt.id}`, lat: coords.lat, lng: coords.lng,
          type: "irl-event", label: evt.title, event: evt,
        });
      }

      if (!cancelled) {
        setMarkers([...allMarkers]);
        setLoading(false);
      }

      if (!cancelled) setLoadingStatus("");

      // Phase 2: geocode uncached user locations in background
      for (let i = 0; i < uncachedUserLocs.length; i++) {
        const { inboxId, username, profile, location } = uncachedUserLocs[i];
        if (!cancelled) setLoadingStatus(`Geocoding ${i + 1}/${uncachedUserLocs.length}...`);
        if (cancelled) return;
        const coords = await geocodeLocation(location);
        if (!coords || cancelled) continue;
        allMarkers.push({
          id: `user-${inboxId}`, lat: coords.lat, lng: coords.lng,
          type: "user", label: username, inboxId, username, nftImage: profile.nftImage,
        });
        setMarkers([...allMarkers]);
      }
      if (!cancelled) setLoadingStatus("");
    }

    load();
    return () => { cancelled = true; };
  }, [calendarEvents, profileVersion]);

  // Globe HTML loaded from asset file — avoids Hermes escaping issues
  const [globeHtml, setGlobeHtml] = useState<string>(buildGlobeHtml());

  useEffect(() => {
    loadGlobeHtml().then(html => {
      _cachedGlobeHtml = html;
      setGlobeHtml(html);
    });
  }, []);
  const webViewReady = useRef(false);

  // Send markers to WebView — always sends all markers so WebGL can rebuild clusters correctly.
  // WebGL deduplicates internally and re-groups co-located users on each call.
  const prevMarkerJson = useRef("");
  const sendMarkersToWebView = useCallback((markersToSend: GlobeMarker[]) => {
    if (!webViewRef.current || !webViewReady.current) return;

    // Only resend if the marker set actually changed
    const ids = markersToSend.map(m => m.id).sort().join(",");
    if (ids === prevMarkerJson.current) return;
    prevMarkerJson.current = ids;

    const payload = markersToSend.map(m => {
      let img = m.nftImage ?? null;
      if (img && img.length > 150000) img = null;
      return {
        id: m.id, lat: m.lat, lng: m.lng, type: m.type, label: m.label,
        nftImage: img, inboxId: m.inboxId ?? null, username: m.username ?? null,
      };
    });

    webViewRef.current.postMessage(JSON.stringify({
      action: "addMarkers",
      markers: payload,
    }));
  }, []);

  // Push markers when they change
  useEffect(() => {
    if (markers.length > 0) sendMarkersToWebView(markers);
  }, [markers, sendMarkersToWebView]);

  // When WebView finishes loading, send all current markers
  const handleWebViewLoad = useCallback(() => {
    webViewReady.current = true;
    // Force resend ALL markers since the WebView just loaded
    prevMarkerJson.current = "";
    if (markers.length > 0) sendMarkersToWebView(markers);
  }, [markers, sendMarkersToWebView]);

  // ── Handle messages from WebView (marker taps) ────────────────────────────
  const handleMessage = useCallback((event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.action === "clusterTap" && data.markers) {
        // Cluster tapped — show bottom sheet with all users
        const fullMarkers = data.markers
          .map((m: any) => markers.find(mk => mk.id === m.id) ?? m)
          .filter(Boolean);
        setClusterUsers(fullMarkers);
      } else if (data.action === "markerTap" && data.marker) {
        const m = data.marker;
        const full = markers.find(mk => mk.id === m.id);

        if (m.type === "user" && m.inboxId && onPressUser) {
          const profile = getCachedProfile(m.inboxId);
          onPressUser({
            senderAddress: m.inboxId,
            senderUsername: m.username ?? m.label,
            senderNft: profile?.nftImage ? { mint: "", name: "", image: profile.nftImage } : null,
          });
        } else if (full?.event) {
          setSelectedEvent(full.event);
        }
      }
    } catch { /* ignore bad messages */ }
  }, [markers, onPressUser]);

  const isLumaEvent = (e: any): e is LumaEvent => "source" in e && e.source === "luma";

  // ── Marker list (below globe) ─────────────────────────────────────────────
  const { userMarkers, lumaMarkers, irlMarkers, eventMarkers } = useMemo(() => {
    const um = markers.filter((m: GlobeMarker) => m.type === "user");
    const lm = markers.filter((m: GlobeMarker) => m.type === "luma-event");
    const im = markers.filter((m: GlobeMarker) => m.type === "irl-event");
    return { userMarkers: um, lumaMarkers: lm, irlMarkers: im, eventMarkers: [...lm, ...im] };
  }, [markers]);

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Monke Globe</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* 3D Globe (WebView) — loads once, markers injected via postMessage */}
      <View style={styles.globeContainer}>
          <WebView
            ref={webViewRef}
            source={{ html: globeHtml }}
            style={styles.webView}
            originWhitelist={["*"]}
            javaScriptEnabled
            domStorageEnabled
            allowFileAccess
            allowUniversalAccessFromFileURLs
            mixedContentMode="always"
            androidLayerType="hardware"
            onMessage={handleMessage}
            onLoad={handleWebViewLoad}
            onError={(e) => console.warn("[Globe WebView error]", e.nativeEvent)}
            scrollEnabled={false}
            bounces={false}
            overScrollMode="never"
            setBuiltInZoomControls={false}
            setDisplayZoomControls={false}
          />
      </View>

      {/* Loading status */}
      {loadingStatus ? (
        <Text style={styles.loadingText}>{loadingStatus}</Text>
      ) : null}

      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#9945FF" }]} />
          <Text style={styles.legendText}>Monkes ({userMarkers.length})</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#6CB4EE" }]} />
          <Text style={styles.legendText}>Events ({lumaMarkers.length + onlineEvents.length})</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#10B981" }]} />
          <Text style={styles.legendText}>IRL ({irlMarkers.length})</Text>
        </View>
      </View>

      {/* Tappable marker pills */}
      <View style={styles.markerList}>
        {userMarkers.slice(0, 6).map((m: GlobeMarker) => (
          <Pressable
            key={m.id}
            style={styles.markerPill}
            onPress={() => m.inboxId && onPressUser?.({
              senderAddress: m.inboxId,
              senderUsername: m.username ?? m.label,
              senderNft: m.nftImage ? { mint: "", name: "", image: m.nftImage } : null,
            })}
          >
            {m.nftImage ? (
              <Image source={{ uri: m.nftImage }} style={styles.markerPfp} />
            ) : (
              <View style={[styles.markerPfp, styles.markerPfpFallback]} />
            )}
            <Text style={styles.markerLabel} numberOfLines={1}>{m.label}</Text>
          </Pressable>
        ))}
        {/* Event pins removed — events are tappable on the globe + online events list below */}
      </View>

      {/* Online / unlocated events list */}
      {onlineEvents.length > 0 && (
        <View style={styles.onlineSection}>
          <Text style={styles.onlineSectionTitle}>
            🌐 Online Events ({onlineEvents.length})
          </Text>
          <ScrollView horizontal={false} style={styles.onlineScroll} showsVerticalScrollIndicator={false}>
            {onlineEvents.map(evt => (
              <Pressable
                key={evt.id}
                style={styles.onlineRow}
                onPress={() => setSelectedEvent(evt)}
              >
                <View style={styles.onlineInfo}>
                  <Text style={styles.onlineName} numberOfLines={1}>{evt.name}</Text>
                  <Text style={styles.onlineDate}>
                    {evt.startAt ? new Date(evt.startAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "TBD"}
                  </Text>
                </View>
                <Text style={styles.onlineArrow}>→</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Event RSVP modal */}
      <EventRsvpModal
        visible={!!selectedEvent}
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
        onSendRsvp={onSendRsvp}
      />

      {/* Cluster bottom sheet — shows all users at a location */}
      <Modal
        visible={clusterUsers.length > 0}
        transparent
        animationType="slide"
        onRequestClose={() => setClusterUsers([])}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setClusterUsers([])}>
          <Pressable style={styles.clusterSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.clusterHandle} />
            <Text style={styles.clusterTitle}>
              {clusterUsers.length} Monkes at this location
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.clusterScroll}>
              {clusterUsers.map((m: GlobeMarker) => (
                <Pressable
                  key={m.id}
                  style={styles.clusterUser}
                  onPress={() => {
                    setClusterUsers([]);
                    if (m.inboxId && onPressUser) {
                      const profile = getCachedProfile(m.inboxId);
                      onPressUser({
                        senderAddress: m.inboxId,
                        senderUsername: m.username ?? m.label,
                        senderNft: profile?.nftImage ? { mint: "", name: "", image: profile.nftImage } : null,
                      });
                    }
                  }}
                >
                  {m.nftImage ? (
                    <Image source={{ uri: m.nftImage }} style={styles.clusterPfp} />
                  ) : (
                    <View style={[styles.clusterPfp, styles.clusterPfpFallback]} />
                  )}
                  <Text style={styles.clusterName} numberOfLines={1}>{m.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: THEME.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingTop: 52, paddingHorizontal: 16, paddingBottom: 8,
  },
  backBtn: { paddingVertical: 4, paddingRight: 12 },
  backText: { fontFamily: FONTS.bodyMed, fontSize: 14, color: "#6CB4EE" },
  headerTitle: {
    fontFamily: FONTS.display, fontSize: 20, color: THEME.text,
    textShadowColor: "rgba(108,180,238,0.4)", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 8,
  },
  statPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(108,180,238,0.1)", borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: "rgba(108,180,238,0.15)",
  },
  statNum: { fontFamily: FONTS.display, fontSize: 16, color: "#6CB4EE" },
  statLabel: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textMuted },

  globeContainer: { flex: 1 },
  webView: { flex: 1, backgroundColor: "transparent" },
  loadingOverlay: {
    flex: 1, alignItems: "center", justifyContent: "center", gap: 12,
  },
  loadingText: { fontFamily: FONTS.bodyMed, fontSize: 13, color: THEME.textMuted, textAlign: "center", paddingVertical: 4 },

  legend: {
    flexDirection: "row", justifyContent: "center", gap: 16,
    paddingVertical: 8, paddingHorizontal: 16,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textMuted },

  markerList: {
    flexDirection: "row", flexWrap: "wrap", gap: 6,
    paddingHorizontal: 12, paddingBottom: 20,
  },
  markerPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(153,69,255,0.1)", borderRadius: 16,
    paddingHorizontal: 8, paddingVertical: 5,
    borderWidth: 1, borderColor: "rgba(153,69,255,0.15)", maxWidth: "48%",
  },
  eventPill: {
    backgroundColor: "rgba(108,180,238,0.08)", borderColor: "rgba(108,180,238,0.15)",
  },
  markerPfp: {
    width: 22, height: 22, borderRadius: 11,
  },
  markerPfpFallback: {
    backgroundColor: "rgba(153,69,255,0.2)",
  },
  markerLabel: { fontFamily: FONTS.bodyMed, fontSize: 11, color: THEME.text, flex: 1 },
  attendeeBadge: { fontFamily: FONTS.mono, fontSize: 10, color: "#FFD54F" },

  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center", alignItems: "center", padding: 24,
  },
  eventCard: {
    backgroundColor: "rgba(18,18,26,0.95)", borderRadius: 20, padding: 24, gap: 14,
    borderWidth: 1, borderColor: "rgba(108,180,238,0.2)",
    shadowColor: "#6CB4EE", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 20, elevation: 10,
    alignSelf: "stretch", maxWidth: 360,
  },
  eventTitle: { fontFamily: FONTS.display, fontSize: 20, color: THEME.text },
  eventRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  eventIcon: { fontSize: 16, marginTop: 1 },
  eventDetail: { fontFamily: FONTS.body, fontSize: 14, color: THEME.textMuted, flex: 1, lineHeight: 20 },
  eventLinkBtn: {
    backgroundColor: "rgba(108,180,238,0.12)", borderRadius: 12,
    paddingVertical: 10, alignItems: "center",
    borderWidth: 1, borderColor: "rgba(108,180,238,0.2)",
  },
  eventLinkText: { fontFamily: FONTS.bodySemi, fontSize: 14, color: "#6CB4EE" },
  eventCloseBtn: { paddingVertical: 8, alignItems: "center" },
  eventCloseText: { fontFamily: FONTS.body, fontSize: 13, color: THEME.textFaint },

  // Online events section
  onlineSection: {
    paddingHorizontal: 12, paddingBottom: 8,
  },
  onlineSectionTitle: {
    fontFamily: FONTS.bodySemi, fontSize: 12, color: THEME.textMuted,
    marginBottom: 6,
  },
  onlineScroll: { maxHeight: 120 },
  onlineRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "rgba(108,180,238,0.06)", borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8, marginBottom: 4,
    borderWidth: 1, borderColor: "rgba(108,180,238,0.10)",
  },
  onlineInfo: { flex: 1, marginRight: 8 },
  onlineName: { fontFamily: FONTS.bodyMed, fontSize: 12, color: THEME.text },
  onlineDate: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textDim, marginTop: 2 },
  onlineArrow: { fontSize: 14, color: "#6CB4EE" },

  // Cluster bottom sheet
  clusterSheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(18, 18, 26, 0.97)",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
    borderTopWidth: 1,
    borderTopColor: "rgba(153, 69, 255, 0.2)",
    shadowColor: "#9945FF",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 12,
  },
  clusterHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignSelf: "center",
    marginBottom: 14,
  },
  clusterTitle: {
    fontFamily: FONTS.display,
    fontSize: 16,
    color: THEME.text,
    marginBottom: 14,
  },
  clusterScroll: {
    maxHeight: 120,
  },
  clusterUser: {
    alignItems: "center",
    gap: 6,
    marginRight: 16,
    width: 70,
  },
  clusterPfp: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: "rgba(153, 69, 255, 0.3)",
  },
  clusterPfpFallback: {
    backgroundColor: "rgba(153, 69, 255, 0.15)",
  },
  clusterName: {
    fontFamily: FONTS.bodyMed,
    fontSize: 11,
    color: THEME.textMuted,
    textAlign: "center",
  },
});
