/**
 * liveAudio.ts — Module-level LiveKit Room singleton
 *
 * Persists the Room connection across navigation so users can minimize
 * the Live Audio screen and return to Main Chat without disconnecting.
 * Updates appStore with isInLiveRoom and liveRoomMuted.
 */

import {
  Room,
  RoomEvent,
  ConnectionState,
  type Participant,
} from 'livekit-client';
import { AudioSession } from '@livekit/react-native';

export type LiveAudioState = {
  participants: Participant[];
  speakers: Set<string>;
  muted: boolean;
};

type StateListener = (state: LiveAudioState) => void;

let _room: Room | null = null;
let _isMuted = false;
let _speakers = new Set<string>();
let _listeners = new Set<StateListener>();
let _onDisconnectCallback: (() => void) | null = null;

function _notify() {
  if (!_room) return;
  const remote = [..._room.remoteParticipants.values()];
  const local = _room.localParticipant;
  const all: Participant[] = local
    ? [local as unknown as Participant, ...remote]
    : remote;
  const state: LiveAudioState = { participants: all, speakers: _speakers, muted: _isMuted };
  _listeners.forEach(fn => fn(state));
}

export function addStateListener(fn: StateListener): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function getRoom(): Room | null { return _room; }

export function getRoomConnectionState(): ConnectionState {
  return _room?.state ?? ConnectionState.Disconnected;
}

export function getMuted(): boolean { return _isMuted; }

export async function connectToRoom(
  url: string,
  token: string,
  onDisconnect: () => void,
): Promise<void> {
  if (_room) await disconnectFromRoom();

  _room = new Room();
  _isMuted = false;
  _speakers = new Set();
  _onDisconnectCallback = onDisconnect;

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

  _room.on(RoomEvent.Disconnected, () => {
    _onDisconnectCallback?.();
  });

  await AudioSession.startAudioSession();
  await _room.connect(url, token);
  await _room.localParticipant.setMicrophoneEnabled(true);
  _notify();
}

export async function disconnectFromRoom(): Promise<void> {
  if (!_room) return;
  _onDisconnectCallback = null;
  try {
    await _room.disconnect();
    await AudioSession.stopAudioSession();
  } catch { /* ignore */ }
  _room = null;
  _isMuted = false;
  _speakers = new Set();
  _listeners.forEach(fn => fn({ participants: [], speakers: new Set(), muted: false }));
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
