import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";

export function errorMessage(err: unknown): string {
  return err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong.";
}

/** Loads data on mount (and whenever `deps` change); `reload()` refetches. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const d = await fnRef.current();
      if (mine === seq.current) {
        setData(d);
        setError("");
      }
    } catch (e) {
      if (mine === seq.current) setError(errorMessage(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void reload(), deps);
  return { data, error, loading, reload, setData };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
