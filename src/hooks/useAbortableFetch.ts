import { useEffect, useRef, useCallback } from "react";

/**
 * useAbortableFetch — fetch wrapper that auto-cancels in-flight requests on unmount.
 *
 * Usage:
 *   const fetchAbortable = useAbortableFetch();
 *   const res = await fetchAbortable(url, { ... });
 *
 * If the caller passes their own `signal` in init, both signals are honored
 * (request aborts on whichever fires first). On component unmount, every
 * in-flight request started via this hook is aborted.
 */
export function useAbortableFetch(): (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response> {
  const controllersRef = useRef<Set<AbortController>>(new Set());

  useEffect(() => {
    const controllers = controllersRef.current;
    return () => {
      for (const c of controllers) c.abort();
      controllers.clear();
    };
  }, []);

  return useCallback(async (input, init) => {
    const ctrl = new AbortController();
    controllersRef.current.add(ctrl);

    if (init?.signal) {
      const upstream = init.signal;
      if (upstream.aborted) ctrl.abort();
      else upstream.addEventListener("abort", () => ctrl.abort(), { once: true });
    }

    try {
      return await fetch(input, { ...init, signal: ctrl.signal });
    } finally {
      controllersRef.current.delete(ctrl);
    }
  }, []);
}
