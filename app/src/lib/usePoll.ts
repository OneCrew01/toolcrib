import { useEffect, useRef, useState } from "react";

export interface PollState<T> {
  data: T | null;
  error: string | null;
}

/**
 * Poll an async source on a fixed interval. Overlapping requests are skipped
 * (a slow response never stacks another behind it); stale responses from a
 * previous key are dropped. `key` restarts the poll (e.g. a new jobId).
 */
export function usePoll<T>(
  fn: () => Promise<T>,
  intervalMs: number,
  key: string,
): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let alive = true;
    let busy = false;
    setData(null);
    setError(null);

    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const next = await fnRef.current();
        if (alive) {
          setData(next);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        busy = false;
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), intervalMs);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [intervalMs, key]);

  return { data, error };
}
