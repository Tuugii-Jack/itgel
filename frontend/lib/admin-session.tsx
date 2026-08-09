"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { adminApi, readToken, writeToken } from "./api";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface AdminSession {
  user: AdminUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
}

const Ctx = createContext<AdminSession | null>(null);

export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!readToken("admin")) {
      setUser(null);
      setLoading(false);
      return;
    }
    adminApi
      .me()
      .then(setUser)
      .catch(() => {
        writeToken("admin", null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  // Нэвтрээгүй бол нэвтрэх хуудас руу.
  useEffect(() => {
    if (loading) return;
    if (!user && pathname !== "/admin/login") router.replace("/admin/login");
    if (user && pathname === "/admin/login") router.replace("/admin");
  }, [user, loading, pathname, router]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const result = await adminApi.login(email, password);
      writeToken("admin", result.token);
      setUser(result.user);
      router.replace("/admin");
    },
    [router],
  );

  const signOut = useCallback(() => {
    writeToken("admin", null);
    setUser(null);
    router.replace("/admin/login");
  }, [router]);

  const value = useMemo<AdminSession>(
    () => ({ user, loading, signIn, signOut }),
    [user, loading, signIn, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdminSession(): AdminSession {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAdminSession нь AdminSessionProvider дотор байх ёстой.");
  return ctx;
}
