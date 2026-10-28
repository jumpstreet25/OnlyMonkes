// Web stand-in for livekit-client (metro.config.js aliases it on web only;
// the phone build imports the real package as before).
//
// livekit-client is ~1.2 MB of source and was in the web entry bundle because
// src/lib/liveVideo.ts / avatarRoom.ts are imported by the chat screen and the
// app store. Here the real package is loaded with import() only when a
// Video/Avatar Room is opened: VideoRoomScreen / AvatarRoomScreen await
// loadLivekit() (via src/lib/livekitPreload.web.ts) before connecting.
//
// Until it has loaded, only the enums read outside a live room are available
// (ConnectionState, Track.Source, RoomEvent names). `new Room()` returns the
// real Room once loaded and throws before that.

type LK = any;
let _lk: LK | null = null;
let _loading: Promise<LK> | null = null;

export function loadLivekit(): Promise<LK> {
  if (_lk) return Promise.resolve(_lk);
  if (!_loading) {
    // Resolves to the real package (metro.config.js skips the alias for this file).
    _loading = import('livekit-client').then((m) => { _lk = m; return m; });
    _loading.catch(() => { _loading = null; });
  }
  return _loading;
}

// Same values as livekit-client 2.x.
export const ConnectionState = {
  Disconnected: 'disconnected',
  Connecting: 'connecting',
  Connected: 'connected',
  Reconnecting: 'reconnecting',
  SignalReconnecting: 'signalReconnecting',
} as const;

const TRACK_SOURCE = {
  Camera: 'camera',
  Microphone: 'microphone',
  ScreenShare: 'screen_share',
  ScreenShareAudio: 'screen_share_audio',
  Unknown: 'unknown',
} as const;

export const Track: any = new Proxy({ Source: TRACK_SOURCE }, {
  get(target: any, key) {
    if (_lk) return _lk.Track[key as any];
    return target[key as any];
  },
});

// RoomEvent values are the key with a lower-case first letter, except these.
const ROOM_EVENT_EXCEPTIONS: Record<string, string> = {
  AudioPlaybackStatusChanged: 'audioPlaybackChanged',
  VideoPlaybackStatusChanged: 'videoPlaybackChanged',
  DCBufferStatusChanged: 'dcBufferStatusChanged',
};
export const RoomEvent: any = new Proxy({}, {
  get(_t, key) {
    if (_lk) return _lk.RoomEvent[key as any];
    if (typeof key !== 'string') return undefined;
    return ROOM_EVENT_EXCEPTIONS[key] ?? key.charAt(0).toLowerCase() + key.slice(1);
  },
});

function requireLoaded(what: string): LK {
  if (!_lk) throw new Error(`[livekit] ${what} used before livekit-client loaded (call loadLivekit() first)`);
  return _lk;
}

export const VideoPresets: any = new Proxy({}, {
  get(_t, key) { return requireLoaded('VideoPresets').VideoPresets[key as any]; },
});

export const Room: any = function Room(this: unknown, ...args: unknown[]) {
  const lk = requireLoaded('Room');
  return new lk.Room(...args);
};
