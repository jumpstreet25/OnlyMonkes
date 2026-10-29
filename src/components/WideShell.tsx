import type { ReactNode } from "react";

/** Native: the phone layout as is. The web wide layout lives in WideShell.web.tsx. */
export function WideShell({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
