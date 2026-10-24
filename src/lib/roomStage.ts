/** Avatar Room 3D stage state (src/components/MonkeRoomStage.tsx → public/viewer/room.html). */
import type { AvatarParticipant } from "@/lib/avatarRoom";
import type { BlendshapeParams } from "@/lib/faceTracking";

export interface StageMember {
  id: string;
  n: number | null;
  name: string;
  muted: boolean;
  speaking: boolean;
  energy: number;
  face?: BlendshapeParams;
}

/** Room state for the stage. Muted members carry no face, voice or speaking flag. */
export function stageMembers(participants: AvatarParticipant[], numberFor: (identity: string, isLocal: boolean) => number | null): StageMember[] {
  return participants.map((p) => ({
    id: p.identity,
    n: numberFor(p.identity, p.isLocal),
    name: p.isLocal ? "You" : p.name,
    muted: p.isMuted,
    speaking: !p.isMuted && p.isSpeaking,
    energy: p.isMuted ? 0 : p.audioEnergy,
    ...(!p.isMuted && p.blendshapes ? { face: p.blendshapes } : {}),
  }));
}
