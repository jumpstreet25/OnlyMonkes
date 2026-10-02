/**
 * MonkeMemeScreen — turn your Saga Monke into a cartoon meme.
 *
 * Holder-gated like the chats (verified Saga Monke, no confirmed
 * hardware-integrity failure). Flow: pick a monke → trait board (prefilled
 * from its on-chain traits, editable) → short scene (≤140 chars) →
 * FLUX.2 [klein] on a Hugging Face ZeroGPU Space, called from this phone so
 * the user's own free GPU runs pay for it, with our Workers AI route as the
 * free, capped fallback (lib/monkeMeme/generate.ts) → caption + watermark
 * composed in RN → captured with view-shot → shared to X with the image
 * attached (shareImageToX), or anywhere via the system share sheet.
 *
 * OTA-safe: react-native-view-shot, react-native-share and
 * expo-media-library are all in the runtime 3.4 binary (commit d118d8386).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  Image,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { THEME, FONTS, NFT_COLLECTION_ADDRESS, MONKE_LEDGER_URL } from "@/lib/constants";
import { useAppStore } from "@/store/appStore";
import { WorldScreenShell, useWorldGlassCardStyle } from "@/components/worlds/WorldScreenShell";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { shareImageToX } from "@/lib/shareToX";
import type { OwnedNFT } from "@/types";
import {
  TRAIT_CATALOG,
  TRAIT_CATEGORIES,
  selectionFromTraits,
  traitLabel,
  type TraitCategory,
  type TraitSelection,
} from "@/lib/monkeMeme/traitCatalog";
import {
  buildMemePrompt,
  checkCaption,
  checkScene,
  CAPTION_MAX_CHARS,
  SCENE_MAX_CHARS,
  SCENE_PRESETS,
} from "@/lib/monkeMeme/prompt";
import { getMonkeMemeConfig, monkeMemeVisible, type MonkeMemeConfig } from "@/lib/monkeMeme/config";
import { SpaceError, type SpaceImage } from "@/lib/monkeMeme/spaceClient";
import { generateMeme } from "@/lib/monkeMeme/generate";
import { getUsedToday, recordGeneration } from "@/lib/monkeMeme/usage";
import { isWave2, monkeImageForNumber, parseMonkeNumber, traitsForNumber, wave2Description } from "@/lib/monkeMeme/monkeNumbers";

const getViewShot = () => import("react-native-view-shot");

// The klein Space rejects reference images larger than 512px (silently —
// /call returns a null error), so captures are pinned to exactly 512.
const CAPTURE_SIZE = 512;

function uniqueMonkes(all: OwnedNFT[], verified: OwnedNFT | null): OwnedNFT[] {
  const out: OwnedNFT[] = [];
  const seen = new Set<string>();
  // The verified NFT is the one ownership was proven for — always eligible.
  for (const n of [verified, ...all]) {
    if (!n?.image || seen.has(n.mint)) continue;
    if (n !== verified && n.collectionMint !== NFT_COLLECTION_ADDRESS) continue;
    seen.add(n.mint);
    out.push(n);
  }
  return out;
}

interface ActiveMonke {
  number: number | null;
  image: string;
  /** Set when it's one of the holder's own monkes (traits available). */
  nft: OwnedNFT | null;
}

function activeFromOwned(m: OwnedNFT): ActiveMonke {
  const number = parseMonkeNumber(m.name);
  return { number, image: (number && monkeImageForNumber(number)) || m.image!, nft: m };
}

async function fetchLedgerTraits(mint: string): Promise<OwnedNFT["traits"]> {
  try {
    const res = await fetchWithTimeout(`${MONKE_LEDGER_URL}/metadata/${encodeURIComponent(mint)}`, { timeoutMs: 8000 });
    if (!res.ok) return undefined;
    const json = (await res.json()) as { traits?: { trait_type?: unknown; value?: unknown }[] };
    return (json.traits ?? [])
      .filter((t) => typeof t.trait_type === "string" && typeof t.value === "string")
      .map((t) => ({ trait_type: t.trait_type as string, value: t.value as string }));
  } catch {
    return undefined;
  }
}

export default function MonkeMemeScreen() {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const cardStyle = useWorldGlassCardStyle();

  const verified = useAppStore((s) => s.verified);
  const integrity = useAppStore((s) => s.deviceIntegrityStatus);
  const verifiedNft = useAppStore((s) => s.verifiedNft);
  const allNfts = useAppStore((s) => s.allNfts);
  const walletAddress = useAppStore((s) => s.wallet?.address ?? null);
  const isAdmin = useAppStore((s) => s.isGroupAdmin);

  const monkes = useMemo(() => uniqueMonkes(allNfts ?? [], verifiedNft), [allNfts, verifiedNft]);
  const [selected, setSelected] = useState<ActiveMonke | null>(null);
  const [numberInput, setNumberInput] = useState("");
  const [baseTraits, setBaseTraits] = useState<TraitSelection>({});
  const [traits, setTraits] = useState<TraitSelection>({});
  const [openCat, setOpenCat] = useState<TraitCategory | null>(null);
  const [scene, setScene] = useState("");
  const [caption, setCaption] = useState("");

  const [cfg, setCfg] = useState<MonkeMemeConfig | null>(null);
  const [used, setUsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultLoaded, setResultLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pfpReady, setPfpReady] = useState(false);
  const [styleReady, setStyleReady] = useState(false);
  const [sharing, setSharing] = useState(false);

  const pfpRef = useRef<View>(null);
  const styleRef = useRef<View>(null);
  const memeRef = useRef<View>(null);
  const loadedImageRef = useRef<string | null>(null);

  const allowed = verified && integrity !== "hardware_failed";
  const memeSize = Math.min(width - 32, 480);
  const limit = cfg?.dailyLimit ?? 0;
  const left = Math.max(0, limit - used);

  useEffect(() => {
    getMonkeMemeConfig().then(setCfg);
    getUsedToday().then(setUsed);
  }, []);

  useEffect(() => {
    if (!selected && monkes.length) setSelected(activeFromOwned(monkes[0]));
  }, [monkes, selected]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    // Only a different image remounts the capture view (keyed by image URL);
    // a refreshed object for the same monke keeps the already-loaded image.
    if (loadedImageRef.current !== selected.image) {
      loadedImageRef.current = selected.image;
      setPfpReady(false);
    }
    const apply = (list: OwnedNFT["traits"]) => {
      if (cancelled) return;
      const sel = selectionFromTraits(list);
      setBaseTraits(sel);
      setTraits(sel);
    };
    const nft = selected.nft;
    // Known number → packed trait table (instant, offline, any monke). Wave 2
    // 1/1s come back empty and are described in words instead (wave2Description).
    const fromTable = selected.number !== null ? traitsForNumber(selected.number) : {};
    if (Object.keys(fromTable).length || (selected.number !== null && isWave2(selected.number))) {
      if (!cancelled) {
        setBaseTraits(fromTable);
        setTraits(fromTable);
      }
    } else if (nft?.traits?.length) apply(nft.traits);
    else if (nft) fetchLedgerTraits(nft.mint).then(apply);
    else apply([]);
    return () => {
      cancelled = true;
    };
  }, [selected]);

  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  const capture = useCallback(async (ref: React.RefObject<View | null>, size: number) => {
    const { captureRef } = await getViewShot();
    return captureRef(ref as never, { format: "png", quality: 1, result: "tmpfile", width: size, height: size });
  }, []);

  const loadNumber = useCallback(() => {
    const n = parseMonkeNumber(numberInput);
    if (n === null) return setError(t("monkeMeme.err.badNumber"));
    setError(null);
    const own = monkes.find((m) => parseMonkeNumber(m.name) === n);
    setSelected(own ? activeFromOwned(own) : { number: n, image: monkeImageForNumber(n)!, nft: null });
    setResultUrl(null);
  }, [numberInput, monkes, t]);

  const generate = useCallback(async () => {
    if (!cfg || !selected || busy) return;
    setError(null);
    if (left <= 0) return setError(t("monkeMeme.limitReached"));
    const s = checkScene(scene);
    if (!s.ok) return setError(t(`monkeMeme.err.${s.reason}`));
    const c = checkCaption(caption);
    if (!c.ok) return setError(t("monkeMeme.err.blocked"));
    if (!pfpReady) return setError(t("monkeMeme.err.pfpLoading"));

    setBusy(true);
    setResultUrl(null);
    setResultLoaded(false);
    try {
      const images: SpaceImage[] = [{ uri: await capture(pfpRef, CAPTURE_SIZE), name: "monke.png" }];
      // The style reference is a plain trait-less monke. With trait words in
      // the prompt it only steers the drawing style, but for art-only monkes
      // (Wave 2 1/1s, monkes picked by number) the model copies its character
      // instead of image 1 — tested on #8930 — so those get the style in words.
      const description = selected.number !== null ? wave2Description(selected.number) : null;
      const artOnly = !!description || Object.keys(traits).length === 0;
      if (styleReady && !artOnly) {
        try {
          images.push({ uri: await capture(styleRef, CAPTURE_SIZE), name: "style.png" });
        } catch {
          // style reference is a nice-to-have; the prompt carries the style in words too
        }
      }
      const prompt = buildMemePrompt({ traits, scene: s.scene, hasStyleRef: images.length > 1, description });
      const { uri } = await generateMeme(cfg, { prompt, images, wallet: walletAddress });
      setResultUrl(uri);
      setUsed(await recordGeneration());
    } catch (e) {
      const kind = e instanceof SpaceError ? e.kind : "failed";
      setError(t(`monkeMeme.err.${kind}`));
    } finally {
      setBusy(false);
    }
  }, [cfg, selected, busy, left, scene, caption, pfpReady, styleReady, traits, capture, walletAddress, t]);

  const shareText = useMemo(() => {
    const line = caption.trim() || scene.trim();
    return `${line ? `${line}\n\n` : ""}${t("monkeMeme.shareText")}`;
  }, [caption, scene, t]);

  const onShareX = useCallback(async () => {
    if (!resultLoaded || sharing) return;
    setSharing(true);
    try {
      await shareImageToX(await capture(memeRef, 1080), shareText);
    } catch {
      setError(t("monkeMeme.err.captureFailed"));
    } finally {
      setSharing(false);
    }
  }, [resultLoaded, sharing, capture, shareText, t]);

  const onShareMore = useCallback(async () => {
    if (!resultLoaded || sharing) return;
    setSharing(true);
    try {
      const uri = await capture(memeRef, 1080);
      const { default: Share } = await import("react-native-share");
      await Share.open({ url: uri, message: shareText, type: "image/png", failOnCancel: false });
    } catch {
      setError(t("monkeMeme.err.captureFailed"));
    } finally {
      setSharing(false);
    }
  }, [resultLoaded, sharing, capture, shareText, t]);

  if (!allowed || (cfg && !monkeMemeVisible(cfg, isAdmin))) {
    const disabled = allowed && cfg && !monkeMemeVisible(cfg, isAdmin);
    return (
      <WorldScreenShell title={t("monkeMeme.title")} onBack={() => router.back()}>
        <View style={styles.center}>
          <View style={[styles.lockCard, cardStyle]}>
            <Text style={styles.lockTitle}>{disabled ? t("monkeMeme.disabledTitle") : t("monkeMeme.lockedTitle")}</Text>
            <Text style={styles.lockBody}>{disabled ? t("monkeMeme.disabledBody") : t("monkeMeme.lockedBody")}</Text>
            {!disabled && (
              <Pressable style={styles.primaryBtn} onPress={() => router.push("/verify" as never)}>
                <Text style={styles.primaryBtnText}>{t("monkeMeme.verifyCta")}</Text>
              </Pressable>
            )}
          </View>
        </View>
      </WorldScreenShell>
    );
  }

  return (
    <WorldScreenShell
      title={t("monkeMeme.title")}
      onBack={() => router.back()}
      headerRight={cfg ? <Text style={styles.leftBadge}>{t("monkeMeme.leftToday", { left, limit })}</Text> : null}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Monke picker */}
        <Text style={styles.section}>{t("monkeMeme.pickMonke")}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {monkes.map((m) => (
            <Pressable
              key={m.mint}
              onPress={() => setSelected(activeFromOwned(m))}
              style={[styles.monkeThumb, selected?.nft?.mint === m.mint && styles.monkeThumbOn]}
            >
              <Image source={{ uri: m.image! }} style={styles.monkeThumbImg} />
              <Text style={styles.monkeName} numberOfLines={1}>{m.name.replace(/^MONKE\s*/i, "")}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Any monke by number — the built-in index covers all 9,999 */}
        <View style={styles.numberRow}>
          <TextInput
            style={[styles.input, styles.numberInput, cardStyle]}
            value={numberInput}
            onChangeText={(v) => setNumberInput(v.replace(/[^0-9]/g, "").slice(0, 5))}
            placeholder={t("monkeMeme.numberPlaceholder")}
            placeholderTextColor={THEME.textDim}
            keyboardType="number-pad"
            returnKeyType="go"
            onSubmitEditing={loadNumber}
          />
          <Pressable style={styles.numberBtn} onPress={loadNumber}>
            <Text style={styles.numberBtnText}>{t("monkeMeme.loadNumber")}</Text>
          </Pressable>
        </View>
        {selected ? (
          <View style={styles.activeRow}>
            <Image source={{ uri: selected.image }} style={styles.activeImg} />
            <Text style={styles.activeName}>
              {selected.number ? `MONKE #${selected.number}` : selected.nft?.name ?? ""}
              {selected.number !== null && isWave2(selected.number) ? `  ·  ${t("monkeMeme.wave2")}` : ""}
            </Text>
          </View>
        ) : null}

        {/* Trait board — only for monkes with catalog traits */}
        {Object.keys(baseTraits).length === 0 ? (
          <Text style={styles.artNote}>{t("monkeMeme.artOnly")}</Text>
        ) : (
        <>
        <View style={styles.sectionRow}>
          <Text style={styles.section}>{t("monkeMeme.traits")}</Text>
          <Pressable onPress={() => setTraits(baseTraits)} hitSlop={8}>
            <Text style={styles.link}>{t("monkeMeme.resetTraits")}</Text>
          </Pressable>
        </View>
        <View style={[styles.card, cardStyle]}>
          {TRAIT_CATEGORIES.map((cat) => {
            const current = traits[cat];
            const isOpen = openCat === cat;
            return (
              <View key={cat}>
                <Pressable style={styles.traitRow} onPress={() => setOpenCat(isOpen ? null : cat)}>
                  <Text style={styles.traitCat}>{t(`monkeMeme.cat.${cat}`)}</Text>
                  <Text style={styles.traitValue}>
                    {current && current !== "None" && current !== "Open" ? traitLabel(current) : t("monkeMeme.none")}
                  </Text>
                  <Text style={styles.chevron}>{isOpen ? "▴" : "▾"}</Text>
                </Pressable>
                {isOpen && (
                  <View style={styles.chipWrap}>
                    {Object.keys(TRAIT_CATALOG[cat]).map((v) => (
                      <Pressable
                        key={v}
                        onPress={() => setTraits((prev) => ({ ...prev, [cat]: v }))}
                        style={[styles.chip, current === v && styles.chipOn]}
                      >
                        <Text style={[styles.chipText, current === v && styles.chipTextOn]}>{traitLabel(v)}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </View>

        </>
        )}

        {/* Scene + caption */}
        <Text style={styles.section}>{t("monkeMeme.scene")}</Text>
        <TextInput
          style={[styles.input, styles.sceneInput, cardStyle]}
          value={scene}
          onChangeText={setScene}
          placeholder={t("monkeMeme.scenePlaceholder")}
          placeholderTextColor={THEME.textDim}
          maxLength={SCENE_MAX_CHARS}
          multiline
        />
        <Text style={styles.counter}>{scene.length}/{SCENE_MAX_CHARS}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {SCENE_PRESETS.map((p) => (
            <Pressable key={p} style={styles.chip} onPress={() => setScene(p)}>
              <Text style={styles.chipText}>{p}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <Text style={styles.section}>{t("monkeMeme.caption")}</Text>
        <TextInput
          style={[styles.input, cardStyle]}
          value={caption}
          onChangeText={setCaption}
          placeholder={t("monkeMeme.captionPlaceholder")}
          placeholderTextColor={THEME.textDim}
          maxLength={CAPTION_MAX_CHARS}
        />

        <Pressable
          style={[styles.primaryBtn, (busy || !selected || left <= 0) && styles.btnDisabled]}
          onPress={generate}
          disabled={busy || !selected || left <= 0}
        >
          {busy ? (
            <View style={styles.busyRow}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.primaryBtnText}>{t("monkeMeme.generating", { s: elapsed })}</Text>
            </View>
          ) : (
            <Text style={styles.primaryBtnText}>{resultUrl ? t("monkeMeme.regenerate") : t("monkeMeme.generate")}</Text>
          )}
        </Pressable>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/* Result — this exact view is what gets captured and shared */}
        {resultUrl ? (
          <View style={styles.resultWrap}>
            <View ref={memeRef} collapsable={false} style={[styles.meme, { width: memeSize, height: memeSize }]}>
              <Image
                source={{ uri: resultUrl }}
                style={StyleSheet.absoluteFill}
                onLoad={() => setResultLoaded(true)}
                onError={() => setError(t("monkeMeme.err.failed"))}
              />
              {caption.trim() ? (
                <Text style={[styles.memeCaption, { fontSize: Math.max(18, memeSize / 14) }]}>{caption.trim().toUpperCase()}</Text>
              ) : null}
              <Text style={styles.watermark}>MonkeMeme · @xOnlyMonkes</Text>
            </View>
            {!resultLoaded && <ActivityIndicator style={styles.resultSpinner} color={THEME.accent} />}
            <View style={styles.shareRow}>
              <Pressable style={[styles.shareBtn, !resultLoaded && styles.btnDisabled]} onPress={onShareX} disabled={!resultLoaded}>
                <Text style={styles.shareBtnText}>{t("monkeMeme.shareX")}</Text>
              </Pressable>
              <Pressable style={[styles.shareBtnAlt, !resultLoaded && styles.btnDisabled]} onPress={onShareMore} disabled={!resultLoaded}>
                <Text style={styles.shareBtnText}>{t("monkeMeme.shareMore")}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <Text style={styles.footnote}>{t("monkeMeme.footnote")}</Text>
      </ScrollView>

      {/* Off-screen 512px sources for the generator: the PFP and our house
          style reference, captured to local PNGs right before upload. */}
      {selected?.image ? (
        <View key={selected.image} ref={pfpRef} collapsable={false} style={styles.offscreen}>
          <Image
            source={{ uri: selected.image }}
            style={styles.offscreenImg}
            onLoad={() => setPfpReady(true)}
            onError={() => setError(t("monkeMeme.err.pfpFailed"))}
          />
        </View>
      ) : null}
      {cfg?.styleRefUrl ? (
        <View ref={styleRef} collapsable={false} style={[styles.offscreen, { top: CAPTURE_SIZE + 10 }]}>
          <Image source={{ uri: cfg.styleRefUrl }} style={styles.offscreenImg} onLoad={() => setStyleReady(true)} />
        </View>
      ) : null}
    </WorldScreenShell>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 48 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  section: { color: THEME.text, fontFamily: FONTS.display, fontSize: 15, marginTop: 18, marginBottom: 8 },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  link: { color: THEME.accent, fontFamily: FONTS.bodySemi, fontSize: 13, marginTop: 18, marginBottom: 8 },
  row: { gap: 8, paddingRight: 8 },
  card: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 4 },
  monkeThumb: { width: 76, alignItems: "center", padding: 4, borderRadius: 12, borderWidth: 2, borderColor: "transparent" },
  monkeThumbOn: { borderColor: THEME.accent },
  monkeThumbImg: { width: 64, height: 64, borderRadius: 8 },
  monkeName: { color: THEME.textMuted, fontFamily: FONTS.bodyMed, fontSize: 11, marginTop: 4 },
  traitRow: { flexDirection: "row", alignItems: "center", paddingVertical: 11 },
  traitCat: { color: THEME.textMuted, fontFamily: FONTS.bodyMed, fontSize: 13, width: 82 },
  traitValue: { flex: 1, color: THEME.text, fontFamily: FONTS.bodySemi, fontSize: 14 },
  chevron: { color: THEME.textDim, fontSize: 14 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingBottom: 12 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: THEME.surfaceHigh,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  chipOn: { backgroundColor: THEME.accentSoft, borderColor: THEME.accent },
  chipText: { color: THEME.textMuted, fontFamily: FONTS.bodyMed, fontSize: 12 },
  chipTextOn: { color: THEME.text },
  input: {
    color: THEME.text,
    fontFamily: FONTS.body,
    fontSize: 15,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sceneInput: { minHeight: 72, textAlignVertical: "top" },
  counter: { color: THEME.textDim, fontFamily: FONTS.mono, fontSize: 11, alignSelf: "flex-end", marginTop: 4, marginBottom: 8 },
  primaryBtn: {
    marginTop: 20,
    backgroundColor: THEME.accent,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontFamily: FONTS.display, fontSize: 16 },
  btnDisabled: { opacity: 0.5 },
  busyRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  error: { color: THEME.error, fontFamily: FONTS.bodyMed, fontSize: 13, marginTop: 10, textAlign: "center" },
  resultWrap: { alignItems: "center", marginTop: 20 },
  meme: { borderRadius: 16, overflow: "hidden", backgroundColor: THEME.surface },
  memeCaption: {
    position: "absolute",
    top: 12,
    left: 12,
    right: 12,
    textAlign: "center",
    color: "#fff",
    fontFamily: FONTS.display,
    textShadowColor: "#000",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },
  watermark: {
    position: "absolute",
    right: 10,
    bottom: 8,
    color: "rgba(255,255,255,0.85)",
    fontFamily: FONTS.bodySemi,
    fontSize: 11,
    textShadowColor: "#000",
    textShadowRadius: 4,
  },
  resultSpinner: { position: "absolute", top: "40%" },
  shareRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  shareBtn: { backgroundColor: "#000", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 22, borderWidth: 1, borderColor: "#333" },
  shareBtnAlt: { backgroundColor: THEME.surfaceHigh, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 22 },
  shareBtnText: { color: "#fff", fontFamily: FONTS.bodySemi, fontSize: 14 },
  footnote: { color: THEME.textFaint, fontFamily: FONTS.body, fontSize: 11, marginTop: 24, textAlign: "center" },
  leftBadge: { color: THEME.textMuted, fontFamily: FONTS.mono, fontSize: 12 },
  lockCard: { borderRadius: 16, padding: 20, width: "100%", maxWidth: 380 },
  lockTitle: { color: THEME.text, fontFamily: FONTS.display, fontSize: 18, marginBottom: 8 },
  lockBody: { color: THEME.textMuted, fontFamily: FONTS.body, fontSize: 14, lineHeight: 20 },
  numberRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  numberInput: { flex: 1 },
  numberBtn: { backgroundColor: THEME.surfaceHigh, borderRadius: 12, paddingHorizontal: 16, justifyContent: "center" },
  numberBtnText: { color: THEME.text, fontFamily: FONTS.bodySemi, fontSize: 14 },
  activeRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
  activeImg: { width: 44, height: 44, borderRadius: 8 },
  activeName: { color: THEME.text, fontFamily: FONTS.bodySemi, fontSize: 14, flexShrink: 1 },
  artNote: { color: THEME.textMuted, fontFamily: FONTS.body, fontSize: 13, marginTop: 14, lineHeight: 19 },
  offscreen: { position: "absolute", left: -4000, top: 0, width: CAPTURE_SIZE, height: CAPTURE_SIZE },
  offscreenImg: { width: CAPTURE_SIZE, height: CAPTURE_SIZE },
});
