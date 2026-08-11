"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

  const refresh = useCallback(async () => {
    if (!readToken("customer")) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await api.me());
    } catch (error) {
      // Хугацаа нь дууссан токеныг цэвэрлэнэ.
      if (isAuthError(error)) writeToken("customer", null);
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(
    async (token: string) => {
      writeToken("customer", token);
      setLoading(true);
      await refresh();
    },
    [refresh],
  );

  const signOut = useCallback(() => {
    writeToken("customer", null);
    setMe(null);
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
