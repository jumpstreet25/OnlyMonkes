/**
 * avatarRoom.ts — Module-level LiveKit Room singleton for animated avatar rooms.
 *
 * Audio-only (no camera) + per-participant audio energy polling at 15fps +
 * mouth trait exchange via data channel + sticker reactions via data channel.
 *
 * Singleton persists across navigation so users can minimize to pill and
 * return to Main Chat without disconnecting.
 */

import {
  Room,
  RoomEvent,
  ConnectionState,
  type Participant,
  type RemoteParticipant,
} from 'livekit-client';
import { AudioSession } from '@livekit/react-native';
import { Platform, PermissionsAndroid } from 'react-native';
import { type MouthTrait, DEFAULT_MOUTH_TRAIT, parseMouthTrait } from './mouthOverlays';
import {
  type FaceParams,
  type BlendshapeParams,
  BLENDSHAPE_IDLE,
  encodeFaceParams,
  decodeFaceParams,
  encodeBlendshapes,
  decodeBlendshapes,
  faceParamsToEnergy,
  blendshapesToFaceParams,
} from './faceTracking';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AvatarParticipant {
  identity: string;
  name: string;
  isSpeaking: boolean;
  isMuted: boolean;
  isLocal: boolean;
  audioEnergy: number;
  mouthTrait: MouthTrait;
  faceParams: FaceParams | null;
  blendshapes: BlendshapeParams | null;
}

export interface AvatarRoomState {
  participants: AvatarParticipant[];
  connectionState: ConnectionState;
  localMuted: boolean;
}

export interface AvatarReaction {
  stickerUrl: string;
  senderName: string;
  senderId: string;
  ts: number;
}

export interface AvatarRoomData {
  id: string;
  host: string;
  hostId: string;
  ts: number;
  active: boolean;
}

type StateListener = (state: AvatarRoomState) => void;
type ReactionListener = (reaction: AvatarReaction) => void;

// ── Data channel topics ──────────────────────────────────────────────────────

const TOPIC_REACTION = 'avatar_reaction';
const TOPIC_MOUTH_TRAIT = 'avatar_mouth_trait';
const TOPIC_FACE_TRACKING = 'face_tracking';
const TOPIC_BLENDSHAPES = 'blendshapes';

// ── Singleton state ──────────────────────────────────────────────────────────

let _room: Room | null = null;
let _isMuted = false;
let _speakers = new Set<string>();
let _energyPollTimer: ReturnType<typeof setInterval> | null = null;
let _participantEnergy = new Map<string, number>();
let _participantMouthTraits = new Map<string, MouthTrait>();
let _participantFaceParams = new Map<string, FaceParams>();
let _participantBlendshapes = new Map<string, BlendshapeParams>();
let _localIdentityHash = 0;
let _localMouthTrait: MouthTrait = DEFAULT_MOUTH_TRAIT;
let _listeners = new Set<StateListener>();
let _reactionListeners = new Set<ReactionListener>();
let _onDisconnectCallback: (() => void) | null = null;

// ── Internal helpers ─────────────────────────────────────────────────────────

// djb2 hash for identity → 4-byte header matching
function _identityHash(identity: string): number {
  let hash = 5381;
  for (let i = 0; i < identity.length; i++) {
    hash = ((hash << 5) + hash + identity.charCodeAt(i)) | 0;
  }
  return hash;
}

// Identity hash cache for fast lookup on incoming blendshape data
const _identityHashMap = new Map<number, string>();

function _registerIdentityHash(identity: string) {
  _identityHashMap.set(_identityHash(identity), identity);
}

function _findIdentityByHash(hash: number): string | undefined {
  return _identityHashMap.get(hash);
}

function _mapParticipant(p: Participant, isLocal: boolean): AvatarParticipant {
  const identity = p.identity;
  const audioTrack = [...p.trackPublications.values()].find(
    pub => pub.source === 'microphone',
  );
  return {
    identity,
    name: p.name ?? identity.slice(0, 8),
    isSpeaking: _speakers.has(identity),
    isMuted: audioTrack ? audioTrack.isMuted : true,
    isLocal,
    audioEnergy: _participantEnergy.get(identity) ?? 0,
    mouthTrait: _participantMouthTraits.get(identity) ?? DEFAULT_MOUTH_TRAIT,
    faceParams: _participantFaceParams.get(identity) ?? null,
    blendshapes: _participantBlendshapes.get(identity) ?? null,
  };
}

function _notify() {
  if (!_room) return;
  const local = _room.localParticipant;
  const remotes = [..._room.remoteParticipants.values()];
  const all: AvatarParticipant[] = [
    _mapParticipant(local as unknown as Participant, true),
    ...remotes.map(r => _mapParticipant(r as unknown as Participant, false)),
  ];
  const state: AvatarRoomState = {
    participants: all,
    connectionState: _room.state as ConnectionState,
    localMuted: _isMuted,
  };
  _listeners.forEach(fn => fn(state));
}

function _startEnergyPolling() {
  if (_energyPollTimer) return;
  _energyPollTimer = setInterval(() => {
    if (!_room) return;

    let changed = false;
    const local = _room.localParticipant;
    const allParticipants = [
      local as unknown as Participant,
      ..._room.remoteParticipants.values() as unknown as Participant[],
    ];

    for (const p of allParticipants) {
      // LiveKit exposes audioLevel as a 0-1 float on Participant.
      // On React Native, audioLevel may not be populated — fallback to
      // binary speaking state (0.6 if speaking, 0 if not).
      let energy = (p as any).audioLevel ?? 0;
      if (energy === 0 && _speakers.has(p.identity)) {
        energy = 0.6; // binary fallback: "speaking" maps to "open" mouth state
      }
      const prev = _participantEnergy.get(p.identity) ?? 0;
      if (Math.abs(energy - prev) > 0.02) {
        _participantEnergy.set(p.identity, energy);
        changed = true;
      }
    }

    if (changed) _notify();
  }, 67); // ~15fps
}

function _stopEnergyPolling() {
  if (_energyPollTimer) {
    clearInterval(_energyPollTimer);
    _energyPollTimer = null;
  }
}

async function _broadcastMouthTrait() {
  if (!_room?.localParticipant) return;
  const payload = new TextEncoder().encode(JSON.stringify({
    identity: _room.localParticipant.identity,
    mouthTrait: _localMouthTrait,
  }));
  try {
    await _room.localParticipant.publishData(payload, {
      reliable: true,
      topic: TOPIC_MOUTH_TRAIT,
    });
  } catch { /* ignore */ }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function addAvatarStateListener(fn: StateListener): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function addReactionListener(fn: ReactionListener): () => void {
  _reactionListeners.add(fn);
  return () => _reactionListeners.delete(fn);
}

export function getAvatarRoom(): Room | null { return _room; }

export function getConnectionState(): ConnectionState {
  return _room?.state as ConnectionState ?? ConnectionState.Disconnected;
}

export function getMuted(): boolean { return _isMuted; }

export function getActiveSpeaker(): AvatarParticipant | null {
  if (!_room) return null;
  const remotes = [..._room.remoteParticipants.values()];
  for (const r of remotes) {
    if (_speakers.has(r.identity)) return _mapParticipant(r as unknown as Participant, false);
  }
  if (remotes.length > 0) return _mapParticipant(remotes[0] as unknown as Participant, false);
  return _mapParticipant(_room.localParticipant as unknown as Participant, true);
}

export async function connectToAvatarRoom(
  url: string,
  token: string,
  localMouthTrait: MouthTrait,
  onDisconnect: () => void,
): Promise<void> {
  if (_room) await disconnectFromAvatarRoom();

  _room = new Room();
  _isMuted = false;
  _speakers = new Set();
  _participantEnergy = new Map();
  _participantMouthTraits = new Map();
  _participantFaceParams = new Map();
  _localMouthTrait = localMouthTrait;
  _onDisconnectCallback = onDisconnect;

  // Store local user's mouth trait
  // (will be set after connect when identity is known)

  // ── Event listeners ──────────────────────────────────────────────────────

  _room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
    _speakers = new Set(speakers.map(s => s.identity));
    _notify();
  });

  const refresh = () => _notify();
  _room.on(RoomEvent.ParticipantConnected,    (p: RemoteParticipant) => {
    _registerIdentityHash(p.identity); // register for blendshape hash lookup
    refresh();
    _broadcastMouthTrait(); // re-broadcast so newcomer receives it
  });
  _room.on(RoomEvent.ParticipantDisconnected, refresh);
  _room.on(RoomEvent.TrackPublished,          refresh);
  _room.on(RoomEvent.TrackUnpublished,        refresh);
  _room.on(RoomEvent.TrackSubscribed,         refresh);
  _room.on(RoomEvent.TrackUnsubscribed,       refresh);
  _room.on(RoomEvent.TrackMuted,              refresh);
  _room.on(RoomEvent.TrackUnmuted,            refresh);

  _room.on(RoomEvent.Reconnecting, () => console.log('[AvatarRoom] Reconnecting...'));
  _room.on(RoomEvent.Reconnected, () => { console.log('[AvatarRoom] Reconnected'); _notify(); });

  _room.on(RoomEvent.Disconnected, () => {
    _stopEnergyPolling();
    _onDisconnectCallback?.();
  });

  // ── Data channels ────────────────────────────────────────────────────────

  _room.on(RoomEvent.DataReceived, (payload: Uint8Array, _participant?: RemoteParticipant, _kind?: any, topic?: string) => {
    // Binary blendshape data (high frequency, lossy OK)
    if (topic === TOPIC_BLENDSHAPES) {
      const decoded = decodeBlendshapes(payload);
      if (decoded) {
        // Find participant by identity hash
        const identity = _findIdentityByHash(decoded.identityHash);
        if (identity) {
          _participantBlendshapes.set(identity, decoded.params);
          // Also update legacy faceParams + energy for backward compat
          const fp = blendshapesToFaceParams(decoded.params);
          _participantFaceParams.set(identity, fp);
          _participantEnergy.set(identity, fp.mouthOpenness);
          _notify();
        }
      }
      return;
    }

    // Legacy face tracking (JSON, for backward compat)
    if (topic === TOPIC_FACE_TRACKING) {
      const decoded = decodeFaceParams(payload);
      if (decoded) {
        _participantFaceParams.set(decoded.identity, decoded.params);
        _participantEnergy.set(decoded.identity, faceParamsToEnergy(decoded.params));
        _notify();
      }
      return;
    }

    try {
      const text = new TextDecoder().decode(payload);
      const data = JSON.parse(text);

      if (topic === TOPIC_REACTION) {
        const reaction: AvatarReaction = data;
        _reactionListeners.forEach(fn => fn(reaction));
      } else if (topic === TOPIC_MOUTH_TRAIT) {
        const trait = parseMouthTrait(data.mouthTrait);
        if (data.identity) {
          _participantMouthTraits.set(data.identity, trait);
          _notify();
        }
      }
    } catch { /* ignore malformed */ }
  });

  // ── Permissions (Android) ────────────────────────────────────────────────

  if (Platform.OS === 'android') {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  }

  // ── Connect (audio only) ─────────────────────────────────────────────────

  await AudioSession.startAudioSession();
  await _room.connect(url, token);
  await _room.localParticipant.setMicrophoneEnabled(true);

  // Enable Krisp noise cancellation on the mic track (non-fatal if unsupported)
  try {
    const { KrispNoiseFilter, isKrispNoiseFilterSupported } = require('@livekit/react-native-krisp-noise-filter');
    if (isKrispNoiseFilterSupported()) {
      const micPub = _room.localParticipant.getTrackPublication('microphone' as any);
      const audioTrack = micPub?.track;
      if (audioTrack) {
        audioTrack.setProcessor(KrispNoiseFilter());
        console.log('[AvatarRoom] Krisp noise filter enabled');
      }
    }
  } catch { /* Krisp not available — non-fatal */ }

  // Store local mouth trait and register identity hash for blendshape data channel
  const localIdentity = _room.localParticipant.identity;
  _participantMouthTraits.set(localIdentity, _localMouthTrait);
  _registerIdentityHash(localIdentity);
  _localIdentityHash = _identityHash(localIdentity);

  // Register remote participant hashes
  for (const [, rp] of _room.remoteParticipants) {
    _registerIdentityHash(rp.identity);
  }

  // Broadcast mouth trait to room
  await _broadcastMouthTrait();

  // Start audio energy polling
  _startEnergyPolling();

  _notify();
}

export async function disconnectFromAvatarRoom(): Promise<void> {
  if (!_room) return;
  _onDisconnectCallback = null;
  _stopEnergyPolling();
  try {
    await _room.disconnect();
    await AudioSession.stopAudioSession();
  } catch { /* ignore */ }
  _room = null;
  _isMuted = false;
  _speakers = new Set();
  _participantEnergy = new Map();
  _participantMouthTraits = new Map();
  _participantFaceParams = new Map();
  _participantBlendshapes = new Map();
  _identityHashMap.clear();
  _listeners.forEach(fn => fn({
    participants: [],
    connectionState: ConnectionState.Disconnected,
    localMuted: false,
  }));
  _reactionListeners.clear();
}

export async function toggleMute(): Promise<boolean> {
  if (!_room?.localParticipant) return _isMuted;
  _isMuted = !_isMuted;
  try {
    await _room.localParticipant.setMicrophoneEnabled(!_isMuted);
  } catch { /* ignore */ }
  _notify();
  return _isMuted;
}

/**
 * Broadcast local face tracking params to all participants via lossy data channel.
 * Called at ~15fps by FaceTracker component.
 */
export async function sendFaceTrackingData(params: FaceParams): Promise<void> {
  if (!_room?.localParticipant) return;
  const identity = _room.localParticipant.identity;
  // Update local state immediately
  _participantFaceParams.set(identity, params);
  _participantEnergy.set(identity, faceParamsToEnergy(params));
  // Broadcast via lossy data channel (UDP, no retransmit — low latency)
  const payload = encodeFaceParams(identity, params);
  try {
    await _room.localParticipant.publishData(payload, {
      reliable: false,
      topic: TOPIC_FACE_TRACKING,
    });
  } catch { /* ignore */ }
}

/** Send blendshape data (binary, 104 bytes, lossy) — call at ~20fps from FaceTracker. */
export async function sendBlendshapes(params: BlendshapeParams): Promise<void> {
  if (!_room?.localParticipant) return;
  const identity = _room.localParticipant.identity;
  // Update local state immediately
  _participantBlendshapes.set(identity, params);
  const fp = blendshapesToFaceParams(params);
  _participantFaceParams.set(identity, fp);
  _participantEnergy.set(identity, fp.mouthOpenness);
  // Broadcast via lossy data channel (UDP — low latency, latest-wins)
  const payload = encodeBlendshapes(identity, params);
  try {
    await _room.localParticipant.publishData(payload, {
      reliable: false,
      topic: TOPIC_BLENDSHAPES,
    });
  } catch { /* ignore */ }
}

export async function sendReaction(
  stickerUrl: string,
  senderName: string,
  senderId: string,
): Promise<void> {
  if (!_room?.localParticipant) return;
  const reaction: AvatarReaction = { stickerUrl, senderName, senderId, ts: Date.now() };
  const payload = new TextEncoder().encode(JSON.stringify(reaction));
  await _room.localParticipant.publishData(payload, {
    reliable: true,
    topic: TOPIC_REACTION,
  });
  // Fire locally so sender sees own reaction
  _reactionListeners.forEach(fn => fn(reaction));
}

// ── XMTP signaling helpers ───────────────────────────────────────────────────

export function buildAvatarRoomMessage(data: AvatarRoomData): string {
  return `AVATAR_ROOM:${JSON.stringify(data)}`;
}

export function parseAvatarRoomMessage(content: string): AvatarRoomData | null {
  if (!content.startsWith('AVATAR_ROOM:')) return null;
  try {
    return JSON.parse(content.slice(12));
  } catch {
    return null;
  }
}
