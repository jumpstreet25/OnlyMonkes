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
  Linking,
  StatusBar,
} from "react-native";
import { WebView } from "react-native-webview";
import { router } from "expo-router";
import { format } from "date-fns";
import { THEME, FONTS } from "@/lib/constants";
import { useAppStore } from "@/store/appStore";
import { getAllTimeUsers, getCachedProfile } from "@/lib/userProfile";
import { geocodeLocation, getCachedGeodata } from "@/lib/geocode";
import { fetchSolanaEvents, type LumaEvent } from "@/lib/lumaEvents";
import type { CalendarEvent } from "@/store/appStore";
import type { ProfileTarget } from "@/components/UserProfileModal";

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

// Globe HTML is built ONCE — markers are injected later via postMessage
function buildGlobeHtml(): string {

  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"/>
<style>
  *{margin:0;padding:0}
  body{background:#0A0A0F;overflow:hidden;touch-action:none}
  canvas{display:block}
  #tooltip{
    position:absolute;display:none;
    background:rgba(10,10,15,0.9);color:#F8F8FF;
    padding:8px 12px;border-radius:10px;font:12px sans-serif;
    border:1px solid rgba(108,180,238,0.3);
    pointer-events:none;z-index:10;max-width:200px;
    box-shadow:0 0 12px rgba(108,180,238,0.2);
  }
</style>
</head><body>
<div id="tooltip"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128/examples/js/controls/OrbitControls.js"><\/script>
<script>
var MARKERS = [];
let scene, camera, renderer, globe, controls, raycaster, mouse;
let markerMeshes = [];
var pfpCache = {}; // PFP texture cache — persists for lifetime of WebView

init();
animate();

function init() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, window.innerWidth/window.innerHeight, 0.1, 1000);
  camera.position.set(0, 0, 2.5);

  renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x0A0A0F, 1);
  document.body.appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.minDistance = 1.3;
  controls.maxDistance = 4.5;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.5;

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  var dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(5, 3, 5);
  scene.add(dir);
  var blue = new THREE.PointLight(0x6CB4EE, 0.4, 10);
  blue.position.set(-3, 2, 3);
  scene.add(blue);

  // Globe
  var geo = new THREE.SphereGeometry(1, 64, 64);
  var tex = new THREE.TextureLoader().load(
    "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
  );
  var mat = new THREE.MeshStandardMaterial({ map:tex, metalness:0.1, roughness:0.7 });
  globe = new THREE.Mesh(geo, mat);
  scene.add(globe);

  // Atmosphere
  var atmosGeo = new THREE.SphereGeometry(1.04, 48, 48);
  var atmosMat = new THREE.MeshBasicMaterial({
    color:0x6CB4EE, transparent:true, opacity:0.06, side:THREE.BackSide
  });
  scene.add(new THREE.Mesh(atmosGeo, atmosMat));

  // Raycaster for tap detection
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  // Load a PFP image into a circular canvas texture (cached in global pfpCache)
  function loadPfpTexture(id, imgSrc, callback) {
    if (pfpCache[id]) { callback(pfpCache[id]); return; }
    var img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = function() {
      var canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      var ctx = canvas.getContext("2d");
      // Clear canvas to fully transparent
      ctx.clearRect(0, 0, 64, 64);
      // Circular clip — only the circle area gets drawn
      ctx.beginPath();
      ctx.arc(32, 32, 30, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, 0, 0, 64, 64);
      var tex = new THREE.CanvasTexture(canvas);
      tex.minFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      pfpCache[id] = tex;
      callback(tex);
    };
    img.onerror = function() { /* skip — no PFP shown */ };
    img.src = imgSrc;
  }

  // ── addMarkers: called from RN via postMessage — adds new markers without reloading globe
  var existingIds = {};
  window.addMarkers = function(newMarkers) {
    newMarkers.forEach(function(m) {
      if (existingIds[m.id]) return; // skip duplicates
      existingIds[m.id] = true;
      MARKERS.push(m);

      var pos = latLngToXYZ(m.lat, m.lng, 1.01);

      if (m.type === "user" && m.nftImage) {
        var spriteMat = new THREE.SpriteMaterial({ transparent: true });
        var sprite = new THREE.Sprite(spriteMat);
        sprite.position.copy(pos);
        sprite.scale.set(0.09, 0.09, 1);
        sprite.userData = m;
        globe.add(sprite);
        markerMeshes.push(sprite);
        loadPfpTexture(m.id, m.nftImage, function(tex) {
          spriteMat.map = tex;
          spriteMat.needsUpdate = true;
        });
      } else if (m.type === "user") {
        var uGeo = new THREE.SphereGeometry(0.018, 12, 12);
        var uMat = new THREE.MeshBasicMaterial({ color:0x9945FF });
        var uMesh = new THREE.Mesh(uGeo, uMat);
        uMesh.position.copy(pos);
        uMesh.userData = m;
        globe.add(uMesh);
        markerMeshes.push(uMesh);
      } else {
        var color = m.type === "luma-event" ? 0x6CB4EE : 0x10B981;
        var eGeo = new THREE.SphereGeometry(0.022, 12, 12);
        var eMat = new THREE.MeshBasicMaterial({ color:color });
        var eMesh = new THREE.Mesh(eGeo, eMat);
        eMesh.position.copy(pos);
        eMesh.userData = m;
        globe.add(eMesh);
        markerMeshes.push(eMesh);

        var erGeo = new THREE.RingGeometry(0.025, 0.04, 16);
        var erMat = new THREE.MeshBasicMaterial({ color:color, transparent:true, opacity:0.25, side:THREE.DoubleSide });
        var ering = new THREE.Mesh(erGeo, erMat);
        ering.position.copy(pos);
        ering.lookAt(0,0,0);
        globe.add(ering);

        var bGeo = new THREE.CylinderGeometry(0.003,0.003,0.15,6);
        var bMat = new THREE.MeshBasicMaterial({color:color, transparent:true, opacity:0.5});
        var beam = new THREE.Mesh(bGeo, bMat);
        var d = pos.clone().normalize();
        beam.position.copy(pos.clone().add(d.multiplyScalar(0.075)));
        beam.lookAt(0,0,0);
        beam.rotateX(Math.PI/2);
        globe.add(beam);
      }
    });
  };

  // Listen for marker data from React Native
  document.addEventListener("message", function(e) {
    try {
      var data = JSON.parse(e.data);
      if (data.action === "addMarkers" && data.markers) {
        window.addMarkers(data.markers);
      }
    } catch(err) {}
  });
  // Android WebView uses window.document for message events
  window.addEventListener("message", function(e) {
    try {
      var data = JSON.parse(e.data);
      if (data.action === "addMarkers" && data.markers) {
        window.addMarkers(data.markers);
      }
    } catch(err) {}
  });

  // Tap handler
  renderer.domElement.addEventListener("pointerup", onTap, false);
  window.addEventListener("resize", function() {
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function latLngToXYZ(lat, lng, r) {
  var phi = (90 - lat) * Math.PI / 180;
  var theta = (lng + 180) * Math.PI / 180;
  return new THREE.Vector3(
    -(r * Math.sin(phi) * Math.cos(theta)),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  );
}

function onTap(e) {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  var hits = raycaster.intersectObjects(markerMeshes);
  if (hits.length > 0) {
    var data = hits[0].object.userData;
    // Send to React Native
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        action: "markerTap",
        marker: data
      }));
    }
  }
}

var tooltip = document.getElementById("tooltip");
function showTooltip(x, y, text) {
  tooltip.style.display = "block";
  tooltip.style.left = x + "px";
  tooltip.style.top = (y - 40) + "px";
  tooltip.textContent = text;
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);

  // Hover tooltip (only on desktop, skip on mobile)
  if (mouse && !("ontouchstart" in window)) {
    raycaster.setFromCamera(mouse, camera);
    var hits = raycaster.intersectObjects(markerMeshes);
    if (hits.length > 0) {
      var d = hits[0].object.userData;
      var emoji = d.type==="user"?"🐒":d.type==="luma-event"?"📍":"🟢";
      showTooltip(
        (hits[0].point.x + 1) * window.innerWidth / 2,
        (-hits[0].point.y + 1) * window.innerHeight / 2,
        emoji + " " + d.label
      );
    } else {
      tooltip.style.display = "none";
    }
  }
}
<\/script>
</body></html>`;
}

// ─── Component ───────────────────────────────────────────────────────────────

interface GlobeScreenProps {
  onPressUser?: (target: ProfileTarget) => void;
}

export default function GlobeScreen({ onPressUser }: GlobeScreenProps) {
  const calendarEvents = useAppStore(s => s.calendarEvents);
  const [loading, setLoading] = useState(true);
  const [markers, setMarkers] = useState<GlobeMarker[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<LumaEvent | CalendarEvent | null>(null);
  const webViewRef = useRef<WebView>(null);

  // ── Load markers (users + events) ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function load() {
      const allMarkers: GlobeMarker[] = [];
      const uncachedUserLocs: { inboxId: string; username: string; profile: any; location: string }[] = [];

      // 1. User locations — Phase 1: show cached locations instantly
      const allUsers = getAllTimeUsers();
      const cachedGeo = await getCachedGeodata();

      for (const [inboxId, username] of allUsers.entries()) {
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
      }

      // 2. Lu.ma Solana events
      try {
        const lumaEvents = await fetchSolanaEvents();
        for (const evt of lumaEvents) {
          if (cancelled) return;
          let lat = evt.lat;
          let lng = evt.lng;
          if (lat == null || lng == null) {
            const coords = await geocodeLocation(evt.location);
            if (coords) { lat = coords.lat; lng = coords.lng; }
          }
          if (lat == null || lng == null) continue;
          allMarkers.push({
            id: `luma-${evt.id}`, lat, lng,
            type: "luma-event", label: evt.name, event: evt,
          });
        }
      } catch { /* non-fatal */ }

      // 3. IRL events from app calendar (only future events — remove after date passes)
      const now = Date.now();
      for (const evt of calendarEvents) {
        if (cancelled) return;
        if (!evt.location || evt.location === "OnlyMonkes") continue;
        // Parse "MM/DD/YYYY" date — skip events that have already passed
        const [mm, dd, yyyy] = (evt.date ?? "").split("/").map(Number);
        if (mm && dd && yyyy) {
          const eventDate = new Date(yyyy, mm - 1, dd, 23, 59, 59).getTime();
          if (eventDate < now) continue; // Event date passed — skip
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

      // Phase 2: geocode uncached user locations in background
      for (const { inboxId, username, profile, location } of uncachedUserLocs) {
        if (cancelled) return;
        const coords = await geocodeLocation(location);
        if (!coords || cancelled) continue;
        allMarkers.push({
          id: `user-${inboxId}`, lat: coords.lat, lng: coords.lng,
          type: "user", label: username, inboxId, username, nftImage: profile.nftImage,
        });
        setMarkers([...allMarkers]);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [calendarEvents]);

  // Globe HTML built ONCE — markers injected via postMessage
  const globeHtml = useMemo(() => buildGlobeHtml(), []);
  const sentMarkerIds = useRef(new Set<string>());
  const webViewReady = useRef(false);

  // Send markers to WebView
  const sendMarkersToWebView = useCallback((markersToSend: GlobeMarker[]) => {
    if (!webViewRef.current || !webViewReady.current) return;
    const newMarkers = markersToSend.filter(m => !sentMarkerIds.current.has(m.id));
    if (newMarkers.length === 0) return;

    newMarkers.forEach(m => sentMarkerIds.current.add(m.id));

    const payload = newMarkers.map(m => {
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
    // Resend ALL markers since the WebView just loaded
    sentMarkerIds.current.clear();
    if (markers.length > 0) sendMarkersToWebView(markers);
  }, [markers, sendMarkersToWebView]);

  // ── Handle messages from WebView (marker taps) ────────────────────────────
  const handleMessage = useCallback((event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.action === "markerTap" && data.marker) {
        const m = data.marker;
        // Find full marker with event data
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
            onMessage={handleMessage}
            onLoad={handleWebViewLoad}
            scrollEnabled={false}
            bounces={false}
            overScrollMode="never"
            setBuiltInZoomControls={false}
            setDisplayZoomControls={false}
          />
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#9945FF" }]} />
          <Text style={styles.legendText}>Monkes ({userMarkers.length})</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#6CB4EE" }]} />
          <Text style={styles.legendText}>Events ({lumaMarkers.length})</Text>
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
        {eventMarkers.slice(0, 4).map((m: GlobeMarker) => (
          <Pressable
            key={m.id}
            style={[styles.markerPill, styles.eventPill]}
            onPress={() => m.event && setSelectedEvent(m.event)}
          >
            <Text style={{ fontSize: 12 }}>{m.type === "luma-event" ? "📍" : "🟢"}</Text>
            <Text style={styles.markerLabel} numberOfLines={1}>{m.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* Event detail modal */}
      <Modal
        visible={!!selectedEvent}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedEvent(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setSelectedEvent(null)}>
          <Pressable style={styles.eventCard} onPress={(e) => e.stopPropagation()}>
            {selectedEvent && (
              <>
                <Text style={styles.eventTitle}>
                  {isLumaEvent(selectedEvent) ? selectedEvent.name : (selectedEvent as CalendarEvent).title}
                </Text>
                <View style={styles.eventRow}>
                  <Text style={styles.eventIcon}>📅</Text>
                  <Text style={styles.eventDetail}>
                    {isLumaEvent(selectedEvent)
                      ? format(new Date(selectedEvent.startAt), "MMM d, yyyy 'at' h:mm a")
                      : `${(selectedEvent as CalendarEvent).date}${(selectedEvent as CalendarEvent).time ? " at " + (selectedEvent as CalendarEvent).time : ""}`}
                  </Text>
                </View>
                <View style={styles.eventRow}>
                  <Text style={styles.eventIcon}>📍</Text>
                  <Text style={styles.eventDetail}>
                    {isLumaEvent(selectedEvent) ? selectedEvent.location : (selectedEvent as CalendarEvent).location}
                  </Text>
                </View>
                {isLumaEvent(selectedEvent) && selectedEvent.url && (
                  <Pressable
                    style={styles.eventLinkBtn}
                    onPress={() => Linking.openURL(selectedEvent.url).catch(() => {})}
                  >
                    <Text style={styles.eventLinkText}>View on Lu.ma →</Text>
                  </Pressable>
                )}
                {!isLumaEvent(selectedEvent) && (selectedEvent as CalendarEvent).purpose ? (
                  <View style={styles.eventRow}>
                    <Text style={styles.eventIcon}>📝</Text>
                    <Text style={styles.eventDetail}>{(selectedEvent as CalendarEvent).purpose}</Text>
                  </View>
                ) : null}
                <Pressable style={styles.eventCloseBtn} onPress={() => setSelectedEvent(null)}>
                  <Text style={styles.eventCloseText}>Close</Text>
                </Pressable>
              </>
            )}
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
  loadingText: { fontFamily: FONTS.bodyMed, fontSize: 13, color: THEME.textMuted },

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
});
