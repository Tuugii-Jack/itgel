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
import { adminApi, api, clearRequestCache, clearSessionClientState, isAuthError, readToken, writeToken } from "./api";
import { clearCheckoutDraft } from "./checkoutDraft";
import { clearCheckoutIdempotencyKey } from "./checkoutIdempotency";
import type { Me } from "./types";
import type { WorkspaceUser } from "./admin-session";

interface Session {
  me: Me | null;
  workspace: WorkspaceUser | null;
  loading: boolean;
  signIn: (
    token: string,
    workspace?: { token: string; user: WorkspaceUser } | null,
  ) => Promise<void>;
  signOut: () => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceUser | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshVersion = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    const token = readToken("customer");
    const isCurrent = () =>
      version === refreshVersion.current && token === readToken("customer");
    try {
      const next = await (token ? api.me() : null);
      if (!isCurrent()) return;
      setMe(next);
      if (readToken("admin")) {
        try {
          const admin = await adminApi.me();
          if (isCurrent()) setWorkspace(admin);
        } catch {
          if (!isCurrent()) return;
          writeToken("admin", null);
          setWorkspace(null);
        }
      } else {
        setWorkspace(null);
      }
    } catch (error) {
      if (!isCurrent()) return;
      if (isAuthError(error)) writeToken("customer", null);
      writeToken("admin", null);
      setMe(null);
      setWorkspace(null);
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
    async (token: string, grant?: { token: string; user: WorkspaceUser } | null) => {
      writeToken("customer", token);
      if (grant !== undefined) {
        writeToken("admin", grant?.token ?? null);
        setWorkspace(grant?.user ?? null);
      }
      clearCheckoutDraft();
      clearCheckoutIdempotencyKey();
      clearRequestCache();
      setMe(null);
      setLoading(true);
      await refresh();
    },
    [refresh],
  );

  const signOut = useCallback(() => {
    refreshVersion.current += 1;
    void adminApi.logout().catch(() => undefined);
    void api.logout().catch(() => undefined);
    clearSessionClientState();
    clearCheckoutDraft();
    clearCheckoutIdempotencyKey();
    setMe(null);
    setWorkspace(null);
    setLoading(false);
  }, []);

  const value = useMemo<Session>(
    () => ({ me, workspace, loading, signIn, signOut, refresh }),
    [me, workspace, loading, signIn, signOut, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSession нь SessionProvider дотор байх ёстой.");
  return ctx;
}
