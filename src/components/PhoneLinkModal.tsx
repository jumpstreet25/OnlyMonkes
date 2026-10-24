/** Phone app: no phone link to show (see PhoneLinkModal.web.tsx). */
export function PhoneLinkModal(_props: {
  visible: boolean;
  url: string | null;
  error: string | null;
  connected: boolean;
  onClose: () => void;
  onStop: () => void;
}) {
  return null;
}
