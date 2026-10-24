/** Phone app: it is the phone, so there's nothing to link (see phoneCompanion.web.ts). */
import type { BlendshapeParams } from "@/lib/faceTracking";

export interface PhoneLink {
  url: string;
  stop(): void;
}

export async function startPhoneLink(_opts: {
  roomName: string;
  identity: string;
  name: string;
  onFace: (params: BlendshapeParams) => void;
  onPhone: (connected: boolean) => void;
}): Promise<PhoneLink> {
  throw new Error("Use my phone is for the website");
}
