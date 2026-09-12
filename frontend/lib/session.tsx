"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, isAuthError, readToken, writeToken } from "./api";
import type { Me } from "./types";

/** Хэрэглэгчийн нэвтрэлт — и-мэйл + нууц үг. */
interface Session {
  me: Me | null;
  loading: boolean;
  signIn: (token: string) => Promise<void>;
  signOut: () => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshVersion = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    const token = readToken("customer");
    const isCurrent = () =>
      version === refreshVersion.current && token === readToken("customer");
    try {
      const next = await (token ? api.me() : null);
      if (isCurrent()) setMe(next);
    } catch (error) {
      if (!isCurrent()) return;
      // Хугацаа нь дууссан токеныг цэвэрлэнэ.
      if (isAuthError(error)) writeToken("customer", null);
      setMe(null);
    } finally {
      if (version === refreshVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void refresh();
    });
    return () => {
      active = false;
      refreshVersion.current += 1;
    };
  }, [refresh]);

  const signIn = useCallback(
    async (token: string) => {
      writeToken("customer", token);
      setMe(null);
      setLoading(true);
      await refresh();
    },
    [refresh],
  );

  const signOut = useCallback(() => {
    refreshVersion.current += 1;
    writeToken("customer", null);
    setMe(null);
    setLoading(false);
  }, []);

  const value = useMemo<Session>(
    () => ({ me, loading, signIn, signOut, refresh }),
    [me, loading, signIn, signOut, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSession нь SessionProvider дотор байх ёстой.");
  return ctx;
}
