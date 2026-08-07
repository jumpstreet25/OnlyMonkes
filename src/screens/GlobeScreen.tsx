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
  ScrollView,
  StatusBar,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { router } from "expo-router";
// date-fns format removed — event formatting moved to EventRsvpModal
import { THEME, FONTS, BOT_INBOX_IDS, BOT_DISPLAY_NAME, BOT_PFP_URL, getWorldBarTint, getWorldAccent } from "@/lib/constants";
import { IS_IMMERSIVE_SHELL } from "@/lib/immersiveStatusBar";
import { MonkeGlass } from "@/components/MonkeGlass";
import { BlurView } from "expo-blur";
import { getBlurProps } from "@/lib/glassTheme";
import { useAppStore } from "@/store/appStore";
import { getCachedProfile, getPersistedLocation, useProfileVersion } from "@/lib/userProfile";
import { isUserOnline, getLastSeenTimestamp } from "@/lib/presence";
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
import * as FileSystem from "expo-file-system/legacy";

let _cachedGlobeHtml: string | null = null;

// globe.html's TextureLoader fetches the earth surface from a third-party
// CDN (unpkg.com) — a 1.46MB, 4096x2048 image, over the network, inside the
// WebView, before the sphere can render, on every single globe open. That's
// the single biggest contributor to "MonkeGlobe is slow" — worse, it's a
// live dependency on an external host with no fallback. Bundled a resized
// (2048x1024, ~390KB) local copy instead; loadGlobeHtml() swaps the CDN URL
// for a local base64 data URI so the texture loads instantly from disk with
// zero network round-trip, same as every other texture in this file (PFP/
// Solana-logo textures already use CanvasTexture from data URIs).
const EARTH_TEXTURE_CDN_URL = "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg";

// globe.html also loaded the three.js engine itself (r128, ~600KB) and
// OrbitControls (~26KB) as render-blocking <script src> tags from two
// separate third-party CDNs (cdnjs, jsdelivr) on every open — nothing in
// the WebView can render, not even the loading placeholder's globe shape,
// until both round trips complete. Same class of bug as the texture above,
// and comparable in size. Bundled locally (renamed .js.txt so Metro treats
// them as opaque assets instead of trying to parse them as app source) and
// inlined as plain <script> bodies in place of the CDN tags.

async function loadGlobeHtml(): Promise<string> {
  if (_cachedGlobeHtml) return _cachedGlobeHtml;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const asset = Asset.fromModule(require("../../assets/globe.html"));
    await asset.downloadAsync();
    const uri = asset.localUri ?? asset.uri;
    let html = await FileSystem.readAsStringAsync(uri);

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const textureAsset = Asset.fromModule(require("../../assets/earth-texture.jpg"));
      await textureAsset.downloadAsync();
      const textureUri = textureAsset.localUri ?? textureAsset.uri;
      const textureB64 = await FileSystem.readAsStringAsync(textureUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      html = html.replace(EARTH_TEXTURE_CDN_URL, `data:image/jpeg;base64,${textureB64}`);
    } catch {
      // Fall back to the CDN URL (still works, just slower/network-dependent)
      // if the local asset fails to resolve for any reason.
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const threeAsset = Asset.fromModule(require("../../assets/three.min.js.txt"));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const orbitAsset = Asset.fromModule(require("../../assets/OrbitControls.js.txt"));
      await Promise.all([threeAsset.downloadAsync(), orbitAsset.downloadAsync()]);
      const [threeJs, orbitJs] = await Promise.all([
        FileSystem.readAsStringAsync(threeAsset.localUri ?? threeAsset.uri),
        FileSystem.readAsStringAsync(orbitAsset.localUri ?? orbitAsset.uri),
      ]);
      html = html
        .replace("/*__THREE_JS__*/", threeJs)
        .replace("/*__ORBIT_CONTROLS_JS__*/", orbitJs);
    } catch {
      // Fall back to CDN script tags if the local assets fail to resolve.
      html = html
        .replace(
          "<script>/*__THREE_JS__*/</script>",
          '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>',
        )
        .replace(
          "<script>/*__ORBIT_CONTROLS_JS__*/</script>",
          '<script src="https://cdn.jsdelivr.net/npm/three@0.128/examples/js/controls/OrbitControls.js"></script>',
        );
    }

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

// ─── Activity dot color ─────────────────────────────────────────────────────
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

/** Green = online now, Yellow = active within 24h, Red = inactive >24h */
function getActivityColor(inboxId: string): string {
  if (isUserOnline(inboxId)) return "#10B981"; // green
  const lastSeen = getLastSeenTimestamp(inboxId);
  // Fall back to profile cachedAt (last PROFILE_UPDATE received)
  const profile = getCachedProfile(inboxId);
  const lastActive = Math.max(lastSeen, profile?.cachedAt ?? 0);
  if (lastActive > 0 && Date.now() - lastActive < TWENTY_FOUR_HOURS) return "#FBBF24"; // yellow
  return "#EF4444"; // red
}

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
      // Catch up on any PROFILE_UPDATE broadcasts older than the Main Chat's
      // 24h history window before building markers — see backfillProfileHistory's
      // doc comment for why this exists (2026-07-20: this was the actual
      // cause of most "missing" Monkes on the globe, not users never having
      // set a location).
      const { backfillProfileHistory } = await import("@/hooks/useXmtp");
      await backfillProfileHistory();

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

      // 0.5. Pin the bot(s) at Solana Beach, CA. App-side hardcode (not driven
      // by PROFILE_UPDATE) so the pin works retroactively for users who never
      // received the bot's profile broadcast — and so it survives any future
      // bot redeploys that drop the loc field.
      //
      // PFP resolution order:
      //   1. Cached profile (from bot's PROFILE_UPDATE broadcast) — freshest
      //      if the bot has rotated its PFP since the constant was last set.
      //   2. Most-recent bot message's enriched senderNft (same source as
      //      the chat bubble image) — covers cache-not-loaded-yet races.
      //   3. BOT_PFP_URL constant — hardcoded last-resort so the marker is
      //      NEVER a fallback purple dot, even on first launch with empty
      //      cache and no bot messages yet visible.
      const BOT_LOCATION = { lat: 32.9914, lng: -117.2714, label: "Solana Beach, CA" };
      const { useChatStore: _ucs } = await import("@/store/chatStore");
      const _allMessages = _ucs.getState().messages;
      const botPfpFromMessages = (botId: string): string | null => {
        for (let i = _allMessages.length - 1; i >= 0; i--) {
          const m = _allMessages[i];
          if (m.senderAddress === botId && m.senderNft?.image) return m.senderNft.image;
        }
        return null;
      };
      for (const botInboxId of BOT_INBOX_IDS) {
        if (seenInboxIds.has(botInboxId)) continue;
        seenInboxIds.add(botInboxId);
        const botProfile = getCachedProfile(botInboxId);
        const botImage = botProfile?.nftImage
          ?? botPfpFromMessages(botInboxId)
          ?? BOT_PFP_URL;
        allMarkers.push({
          id: `user-${botInboxId}`,
          lat: BOT_LOCATION.lat,
          lng: BOT_LOCATION.lng,
          type: "user",
          label: botProfile?.username ?? BOT_DISPLAY_NAME,
          inboxId: botInboxId,
          username: botProfile?.username ?? BOT_DISPLAY_NAME,
          nftImage: botImage,
        });
      }

      // 1. Other user locations from profile cache (deduped by wallet)
      const { getDeduplicatedUsers } = await import("@/lib/userProfile");
      const allUsers = getDeduplicatedUsers();

      // Diagnostic: classify every known user by why they do/don't get a
      // marker. Logged at the end of load() once geocoding (phase 2, below)
      // has had a chance to resolve or fail. See backfillProfileHistory's
      // doc comment in useXmtp.ts for the bug this traces back to.
      const skipReasons = new Map<string, "no-location" | "pending-geocode" | "geocode-failed">();

      for (const [inboxId, username] of allUsers.entries()) {
        if (seenInboxIds.has(inboxId)) continue; // skip self (already added)
        seenInboxIds.add(inboxId);
        const profile = getCachedProfile(inboxId);
        // Check profile cache first, then persistent location map (survives eviction + restart)
        const location = profile?.location || getPersistedLocation(inboxId);
        if (!location) { skipReasons.set(inboxId, "no-location"); continue; }
        const key = location.trim().toLowerCase();
        const cached = cachedGeo[key];

        if (cached) {
          allMarkers.push({
            id: `user-${inboxId}`, lat: cached.lat, lng: cached.lng,
            type: "user", label: username, inboxId, username, nftImage: profile?.nftImage ?? null,
          });
        } else {
          skipReasons.set(inboxId, "pending-geocode");
          uncachedUserLocs.push({ inboxId, username, profile: profile ?? {}, location });
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
        if (!coords || cancelled) {
          if (!coords) skipReasons.set(inboxId, "geocode-failed");
          continue;
        }
        skipReasons.delete(inboxId);
        allMarkers.push({
          id: `user-${inboxId}`, lat: coords.lat, lng: coords.lng,
          type: "user", label: username, inboxId, username, nftImage: profile.nftImage,
        });
        setMarkers([...allMarkers]);
      }
      if (!cancelled) setLoadingStatus("");

      // Diagnostic: log why the marker count doesn't match the group roster.
      // Requested 2026-07-20 after a user reported 6 markers vs 11 known
      // Monkes — root cause was mostly stale profile cache (fixed by
      // backfillProfileHistory above), not users never setting a location.
      // 2026-08-05: traced a second case (3-vs-18 markers between two
      // devices on the same build) to the profile-rebroadcast-on-launch
      // path being gated behind push-token success — see _layout.tsx.
      if (!cancelled && __DEV__) {
        try {
          const { getGroupMembers } = await import("@/hooks/useXmtp");
          const members = await getGroupMembers();
          const neverCached = members.filter(id => id !== myInboxId && !allUsers.has(id) && !BOT_INBOX_IDS.includes(id));
          const noLocation = [...skipReasons.entries()].filter(([, r]) => r === "no-location").map(([id]) => id);
          const geocodeFailed = [...skipReasons.entries()].filter(([, r]) => r === "geocode-failed").map(([id]) => id);
          console.log(
            `[Globe] roster=${members.length} markers(users)=${allMarkers.filter(m => m.type === "user").length} ` +
            `| never-cached=${neverCached.length} no-location=${noLocation.length} geocode-failed=${geocodeFailed.length}`,
          );
          if (neverCached.length > 0) console.log("[Globe] never-cached inboxIds (profile broadcast never received, even after 30d backfill):", neverCached);
          if (noLocation.length > 0) console.log("[Globe] no-location inboxIds (profile cached, location field empty):", noLocation);
          if (geocodeFailed.length > 0) console.log("[Globe] geocode-failed inboxIds (location set but Nominatim couldn't resolve it):", geocodeFailed);
        } catch { /* diagnostic only, never block the globe on this */ }
      }
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
  // Bumped on WebView error → forces a fresh mount via key prop. Resets the
  // handshake state so onLoad fires cleanly and markers re-push.
  const [webViewKey, setWebViewKey] = useState(0);
  const sendMarkersToWebView = useCallback((markersToSend: GlobeMarker[], opts?: { force?: boolean }) => {
    if (!webViewRef.current) return;
    // Watchdog can force a send even if onLoad never fired (Android WebView
    // quirk where the load callback is silent). Trade-off: the marker payload
    // may be dropped if the WebView truly isn't ready, but at worst we lose
    // one redundant send — there's no downside to trying.
    if (!webViewReady.current && !opts?.force) return;

    // Only resend if the marker set actually changed (skipped on force).
    const ids = markersToSend.map(m => m.id).sort().join(",");
    if (!opts?.force && ids === prevMarkerJson.current) return;
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

  // Push markers when they change — debounced. Phase 2 (background geocoding
  // of uncached user locations, below) calls setMarkers() once per user as
  // each one resolves, respecting Nominatim's 1 req/s rate limit. Without
  // debouncing, every single one of those trickle-in updates re-serialized
  // and re-sent the ENTIRE marker list — including every other user's base64
  // NFT avatar (up to 150KB each) — across the WebView bridge again, even
  // though only one marker actually changed. The marker STATE still updates
  // instantly (feeds the below-globe list UI); only the expensive WebView
  // postMessage is coalesced.
  const sendMarkersTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (markers.length === 0) return;
    if (sendMarkersTimer.current) clearTimeout(sendMarkersTimer.current);
    sendMarkersTimer.current = setTimeout(() => {
      sendMarkersToWebView(markers);
    }, 400);
    return () => {
      if (sendMarkersTimer.current) clearTimeout(sendMarkersTimer.current);
    };
  }, [markers, sendMarkersToWebView]);

  // FIX #1: when globeHtml swaps from the synchronous fallback to the real
  // HTML loaded async via loadGlobeHtml(), the WebView remounts. Reset the
  // handshake state so the new mount's onLoad properly re-pushes markers.
  // Without this reset, prevMarkerJson keeps the old id-string and the
  // next setMarkers pass dedupes itself away → empty globe.
  useEffect(() => {
    webViewReady.current = false;
    prevMarkerJson.current = "";
  }, [globeHtml, webViewKey]);

  // FIX #2: watchdog. On some Android devices the WebView's onLoad callback
  // doesn't fire (hardware-accelerated layer + heavy JS bundle race). After
  // 4s, if we still haven't seen onLoad, force a marker push anyway. Worst
  // case it's a no-op; best case it unblocks an otherwise-empty globe.
  useEffect(() => {
    const t = setTimeout(() => {
      if (!webViewReady.current && markers.length > 0) {
        console.warn("[Globe] onLoad watchdog: forcing marker resend after 4s of silence");
        sendMarkersToWebView(markers, { force: true });
      }
    }, 4000);
    return () => clearTimeout(t);
  }, [globeHtml, webViewKey, markers, sendMarkersToWebView]);

  // When WebView finishes loading, send all current markers
  const handleWebViewLoad = useCallback(() => {
    webViewReady.current = true;
    // Force resend ALL markers since the WebView just loaded
    prevMarkerJson.current = "";
    if (markers.length > 0) sendMarkersToWebView(markers);
  }, [markers, sendMarkersToWebView]);

  // FIX #4: WebView error → soft remount. The previous handler logged but
  // never recovered, so a single renderer crash left the globe permanently
  // empty until app restart. Bumping the key forces a fresh WebView, the
  // ready-state useEffect resets the handshake, and onLoad re-pushes
  // markers. Capped at one auto-retry per crash to avoid a remount loop.
  const errorRetryCount = useRef(0);
  const handleWebViewError = useCallback((e: any) => {
    console.warn("[Globe WebView error]", e?.nativeEvent);
    if (errorRetryCount.current < 2) {
      errorRetryCount.current++;
      webViewReady.current = false;
      setWebViewKey((k) => k + 1);
    }
  }, []);

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

  const insets = useSafeAreaInsets();
  // 2026-08-06: glass header chrome so Globe matches Settings/Portfolio/etc.
  // Full WorldLayer behind a WebView globe is wasted (the globe fills the
  // viewport) — only the header needs the world-aware treatment.
  const worldId = useAppStore((s) => s.shopStyles?.worldId) as string | undefined;

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" hidden={IS_IMMERSIVE_SHELL} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        {worldId ? (
          <>
            <BlurView {...getBlurProps()} style={StyleSheet.absoluteFill} pointerEvents="none" />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: getWorldBarTint(worldId) }]} pointerEvents="none" />
          </>
        ) : null}
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Text style={[styles.backText, worldId ? { color: getWorldAccent(worldId) } : null]}>← Back</Text>
        </Pressable>
        <Text style={[styles.headerTitle, worldId ? { color: getWorldAccent(worldId) } : null]}>Monke Globe</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* 3D Globe (WebView) — loads once, markers injected via postMessage */}
      <View style={styles.globeContainer}>
          <WebView
            key={webViewKey}
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
            onError={handleWebViewError}
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
        {userMarkers.map((m: GlobeMarker) => (
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
            {m.inboxId && (
              <View style={[styles.activityDot, { backgroundColor: getActivityColor(m.inboxId) }]} />
            )}
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
      <MonkeGlass
        visible={clusterUsers.length > 0}
        onClose={() => setClusterUsers([])}
        position="bottom"
        animationType="slide"
        cardStyle={styles.clusterSheet}
      >
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
              <View>
                {m.nftImage ? (
                  <Image source={{ uri: m.nftImage }} style={styles.clusterPfp} />
                ) : (
                  <View style={[styles.clusterPfp, styles.clusterPfpFallback]} />
                )}
                {m.inboxId && (
                  <View style={[styles.clusterActivityDot, { backgroundColor: getActivityColor(m.inboxId) }]} />
                )}
              </View>
              <Text style={styles.clusterName} numberOfLines={1}>{m.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </MonkeGlass>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: THEME.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 8,
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
  markerLabel: { fontFamily: FONTS.bodyMed, fontSize: 11, color: THEME.text, flex: 1, marginRight: 2 },
  activityDot: { width: 7, height: 7, borderRadius: 4, borderWidth: 1, borderColor: "rgba(0,0,0,0.3)" },
  attendeeBadge: { fontFamily: FONTS.mono, fontSize: 10, color: "#FFD54F" },

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
    borderColor: "rgba(153, 69, 255, 0.25)",
    shadowColor: "#9945FF",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 12,
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
  clusterActivityDot: {
    position: "absolute", bottom: 0, right: 0,
    width: 10, height: 10, borderRadius: 5,
    borderWidth: 1.5, borderColor: "rgba(18,18,26,0.97)",
  },
  clusterName: {
    fontFamily: FONTS.bodyMed,
    fontSize: 11,
    color: THEME.textMuted,
    textAlign: "center",
  },
});
