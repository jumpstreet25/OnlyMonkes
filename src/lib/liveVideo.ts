/**
 * liveVideo.ts — Module-level LiveKit Room singleton for VIDEO calls
 *
 * Extends the audio-only pattern in liveAudio.ts with camera tracks,
 * screen sharing, simulcast (720p adaptive), and participant video state.
 *
 * Architecture:
 *   ┌──────────────┐     XMTP group msg        ┌──────────────────┐
 *   │ OnlyMonkes   │  ─ VIDEO_ROOM:{json} ──→   │ Other Clients    │
 *   │ (initiator)  │                            │ (auto-join)      │
 *   └──────┬───────┘                            └──────┬───────────┘
 *          │ LiveKit token (client-side JWT)            │
 *          ▼                                            ▼
 *   ┌────────────────────────────────────────────────────────────┐
 *   │            LiveKit SFU (self-hosted Docker)                │
 *   │  wss://your-domain:7880  ·  TURN embedded  ·  simulcast   │
 *   │  DTLS/SRTP media encryption  ·  720p default              │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Self-hosted setup:
 *   docker run -d --name livekit \
 *     -p 7880:7880 -p 7881:7881 -p 7882:7882/udp \
 *     -p 50000-60000:50000-60000/udp \
 *     -e LIVEKIT_KEYS="REDACTED_LIVEKIT_API_KEY: REDACTED_LIVEKIT_API_SECRET" \
 *     -v ./livekit.yaml:/etc/livekit.yaml \
 *     livekit/livekit-server --config /etc/livekit.yaml
 *
 * livekit.yaml (self-hosted with embedded TURN):
 *   port: 7880
 *   rtc:
 *     port_range_start: 50000
 *     port_range_end: 60000
 *     use_external_ip: true
 *     tcp_port: 7881
 *   turn:
 *     enabled: true
 *     domain: your-domain.com
 *     tls_port: 5349
 *     udp_port: 3478
 *   keys:
 *     REDACTED_LIVEKIT_API_KEY: REDACTED_LIVEKIT_API_SECRET
 */

import {
  Room,
  RoomEvent,
  ConnectionState,
  Track,
  VideoPresets,
  type Participant,
  type LocalParticipant,
  type RemoteParticipant,
  type LocalTrackPublication,
  type RemoteTrackPublication,
} from 'livekit-client';
import { AudioSession } from '@livekit/react-native';
import { createLivekitToken, createRoomName, LK_URL } from './livekit';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VideoParticipant {
  identity: string;      // XMTP inboxId
  name: string;          // display name
  isSpeaking: boolean;
  isMuted: boolean;      // audio muted
  isCameraOff: boolean;  // video muted
  isScreenSharing: boolean;
  isLocal: boolean;
}

export interface VideoRoomState {
  participants: VideoParticipant[];
  connectionState: ConnectionState;
  localAudioMuted: boolean;
  localVideoMuted: boolean;
  isScreenSharing: boolean;
}

export interface VideoRoomData {
  id: string;            // LiveKit room name
  host: string;          // host username
  hostId: string;        // host XMTP inboxId
  ts: number;            // start timestamp
  active: boolean;       // false = room ended
  maxParticipants: number;
  type: 'video';         // distinguishes from audio rooms
}

type VideoStateListener = (state: VideoRoomState) => void;

// ─── Reaction types ─────────────────────────────────────────────────────────

export interface VideoReaction {
  stickerUrl: string;
  senderName: string;
  senderId: string;
  ts: number;
}

type ReactionListener = (reaction: VideoReaction) => void;

// ─── Singleton state ─────────────────────────────────────────────────────────

let _room: Room | null = null;
let _audioMuted = false;
let _videoMuted = false;
let _screenSharing = false;
let _speakers = new Set<string>();
let _listeners = new Set<VideoStateListener>();
let _reactionListeners = new Set<ReactionListener>();
let _onDisconnectCallback: (() => void) | null = null;

const DATA_TOPIC_REACTION = 'video_reaction';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapParticipant(p: Participant, isLocal: boolean): VideoParticipant {
  const audioTracks = [...p.trackPublications.values()].filter(
    t => t.source === Track.Source.Microphone,
  );
  const videoTracks = [...p.trackPublications.values()].filter(
    t => t.source === Track.Source.Camera,
  );
  const screenTracks = [...p.trackPublications.values()].filter(
    t => t.source === Track.Source.ScreenShare,
  );

  return {
    identity: p.identity,
    name: p.name ?? p.identity.slice(0, 8),
    isSpeaking: _speakers.has(p.identity),
    isMuted: audioTracks.length === 0 || audioTracks.every(t => t.isMuted),
    isCameraOff: videoTracks.length === 0 || videoTracks.every(t => t.isMuted),
    isScreenSharing: screenTracks.length > 0 && screenTracks.some(t => !t.isMuted),
    isLocal,
  };
}

function _notify(): void {
  if (!_room) return;
  const local = _room.localParticipant;
  const remotes = [..._room.remoteParticipants.values()];
  const participants: VideoParticipant[] = [
    _mapParticipant(local as unknown as Participant, true),
    ...remotes.map(r => _mapParticipant(r as unknown as Participant, false)),
  ];

  const state: VideoRoomState = {
    participants,
    connectionState: _room.state,
    localAudioMuted: _audioMuted,
    localVideoMuted: _videoMuted,
    isScreenSharing: _screenSharing,
  };
  _listeners.forEach(fn => fn(state));
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function addVideoStateListener(fn: VideoStateListener): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function getVideoRoom(): Room | null { return _room; }

export function getVideoConnectionState(): ConnectionState {
  return _room?.state ?? ConnectionState.Disconnected;
}

/**
 * Connect to a LiveKit video room.
 *
 * - Publishes both audio (microphone) and video (camera) tracks
 * - Enables simulcast at 720p for adaptive bitrate
 * - Handles NAT traversal via LiveKit's embedded TURN
 */
export async function connectToVideoRoom(
  url: string,
  token: string,
  onDisconnect: () => void,
): Promise<void> {
  if (_room) await disconnectFromVideoRoom();

  _room = new Room({
    adaptiveStream: true,
    dynacast: true,         // only send layers that are needed
    videoCaptureDefaults: {
      resolution: VideoPresets.h720.resolution, // 720p default
    },
    publishDefaults: {
      simulcast: true,      // simulcast for adaptive quality
      videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
    },
  });

  _audioMuted = false;
  _videoMuted = false;
  _screenSharing = false;
  _speakers = new Set();
  _onDisconnectCallback = onDisconnect;

  // ── Event listeners ──────────────────────────────────────────────────────

  _room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
    _speakers = new Set(speakers.map(s => s.identity));
    _notify();
  });

  const refresh = () => _notify();
  _room.on(RoomEvent.ParticipantConnected,    refresh);
  _room.on(RoomEvent.ParticipantDisconnected, refresh);
  _room.on(RoomEvent.TrackPublished,          refresh);
  _room.on(RoomEvent.TrackUnpublished,        refresh);
  _room.on(RoomEvent.TrackSubscribed,         refresh);
  _room.on(RoomEvent.TrackUnsubscribed,       refresh);
  _room.on(RoomEvent.TrackMuted,              refresh);
  _room.on(RoomEvent.TrackUnmuted,            refresh);
  _room.on(RoomEvent.LocalTrackPublished,     refresh);
  _room.on(RoomEvent.LocalTrackUnpublished,   refresh);

  _room.on(RoomEvent.Disconnected, () => {
    _onDisconnectCallback?.();
  });

  // Automatic reconnection on network drop
  _room.on(RoomEvent.Reconnecting, () => {
    console.log('[VideoRoom] Reconnecting...');
  });
  _room.on(RoomEvent.Reconnected, () => {
    console.log('[VideoRoom] Reconnected');
    _notify();
  });

  // ── Data channel — reactions ──────────────────────────────────────────────

  _room.on(RoomEvent.DataReceived, (payload: Uint8Array, _participant?: RemoteParticipant, _kind?: any, topic?: string) => {
    if (topic !== DATA_TOPIC_REACTION) return;
    try {
      const text = new TextDecoder().decode(payload);
      const reaction: VideoReaction = JSON.parse(text);
      _reactionListeners.forEach(fn => fn(reaction));
    } catch { /* ignore malformed */ }
  });

  // ── Connect ──────────────────────────────────────────────────────────────

  await AudioSession.startAudioSession();
  await _room.connect(url, token);

  // Publish audio + video
  await _room.localParticipant.setCameraEnabled(true);
  await _room.localParticipant.setMicrophoneEnabled(true);

  _notify();
}

export async function disconnectFromVideoRoom(): Promise<void> {
  if (!_room) return;
  _onDisconnectCallback = null;
  try {
    await _room.disconnect();
    await AudioSession.stopAudioSession();
  } catch { /* ignore */ }
  _room = null;
  _audioMuted = false;
  _videoMuted = false;
  _screenSharing = false;
  _speakers = new Set();
  _reactionListeners.clear();
  _listeners.forEach(fn => fn({
    participants: [],
    connectionState: ConnectionState.Disconnected,
    localAudioMuted: false,
    localVideoMuted: false,
    isScreenSharing: false,
  }));
}

// ─── Reactions API ────────────────────────────────────────────────────────────

/** Subscribe to incoming sticker reactions. Returns unsubscribe function. */
export function addReactionListener(fn: ReactionListener): () => void {
  _reactionListeners.add(fn);
  return () => _reactionListeners.delete(fn);
}

/** Broadcast a sticker reaction to all participants via LiveKit data channel. */
export async function sendVideoReaction(
  stickerUrl: string,
  senderName: string,
  senderId: string,
): Promise<void> {
  if (!_room?.localParticipant) return;
  const reaction: VideoReaction = {
    stickerUrl,
    senderName,
    senderId,
    ts: Date.now(),
  };
  const payload = new TextEncoder().encode(JSON.stringify(reaction));
  await _room.localParticipant.publishData(payload, {
    reliable: true,
    topic: DATA_TOPIC_REACTION,
  });
  // Also fire locally so sender sees their own reaction
  _reactionListeners.forEach(fn => fn(reaction));
}

/** Get the active speaker (for PiP bubble). */
export function getActiveSpeaker(): VideoParticipant | null {
  if (!_room) return null;
  const local = _room.localParticipant;
  const remotes = [..._room.remoteParticipants.values()];
  // Return the first speaking remote, else first remote, else local
  for (const r of remotes) {
    if (_speakers.has(r.identity)) return _mapParticipant(r as unknown as Participant, false);
  }
  if (remotes.length > 0) return _mapParticipant(remotes[0] as unknown as Participant, false);
  return _mapParticipant(local as unknown as Participant, true);
}

export async function toggleAudioMute(): Promise<boolean> {
  if (!_room?.localParticipant) return _audioMuted;
  _audioMuted = !_audioMuted;
  await _room.localParticipant.setMicrophoneEnabled(!_audioMuted);
  _notify();
  return _audioMuted;
}

export async function toggleVideoMute(): Promise<boolean> {
  if (!_room?.localParticipant) return _videoMuted;
  _videoMuted = !_videoMuted;
  await _room.localParticipant.setCameraEnabled(!_videoMuted);
  _notify();
  return _videoMuted;
}

export async function toggleCamera(): Promise<void> {
  if (!_room?.localParticipant) return;
  // Switch between front and back camera
  const camTrack = [..._room.localParticipant.trackPublications.values()]
    .find(t => t.source === Track.Source.Camera);
  if (camTrack?.track) {
    // @ts-ignore — switchDevice available on LocalVideoTrack in RN
    await (camTrack.track as any).restartTrack?.({ facingMode: 'environment' });
  }
}

export async function toggleScreenShare(): Promise<boolean> {
  if (!_room?.localParticipant) return _screenSharing;
  _screenSharing = !_screenSharing;
  await _room.localParticipant.setScreenShareEnabled(_screenSharing);
  _notify();
  return _screenSharing;
}

// ─── XMTP signaling message builders/parsers ────────────────────────────────

export function buildVideoRoomMessage(data: VideoRoomData): string {
  return `VIDEO_ROOM:${JSON.stringify(data)}`;
}

export function parseVideoRoomMessage(content: string): VideoRoomData | null {
  if (!content.startsWith('VIDEO_ROOM:')) return null;
  try {
    return JSON.parse(content.slice('VIDEO_ROOM:'.length)) as VideoRoomData;
  } catch {
    return null;
  }
}

/** Create room name + token for a new video call */
export function createVideoRoom(
  hostInboxId: string,
  hostUsername: string,
  maxParticipants = 15,
): { roomData: VideoRoomData; token: string } {
  const roomName = `omv-${Date.now()}-${hostInboxId.slice(0, 8)}`;
  const token = createLivekitToken(roomName, hostInboxId, hostUsername, true);

  const roomData: VideoRoomData = {
    id: roomName,
    host: hostUsername,
    hostId: hostInboxId,
    ts: Date.now(),
    active: true,
    maxParticipants,
    type: 'video',
  };

  return { roomData, token };
}

/** Generate a join token for an existing video room */
export function joinVideoRoom(
  roomName: string,
  inboxId: string,
  username: string,
): string {
  return createLivekitToken(roomName, inboxId, username, true);
}
