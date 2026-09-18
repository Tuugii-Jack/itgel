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
import { adminApi, api, readToken, writeToken } from "./api";
import { clearRequestCache } from "./api/client";
import { deferEffect } from "./deferEffect";
import { clearCheckoutDraft } from "./checkoutDraft";
import { clearCheckoutIdempotencyKey } from "./checkoutIdempotency";
import { canAccessLeasingPortal, canAccessShopPortal, isAdminRole } from "./admin-role";
import { profileLoginPath, workspaceHome } from "./safeNext";

export interface WorkspaceUser {
  id: string;
  email: string;
  name: string;
  role: string;
  hasLoginPhone?: boolean;
  loginPhones?: string[];
  destinations?: string[];
}

interface AdminSession {
  user: WorkspaceUser | null;
  loading: boolean;
  signOut: () => void;
}

const Ctx = createContext<AdminSession | null>(null);

export function AdminSessionProvider({
  children,
  portal = "shop",
}: {
  children: ReactNode;
  portal?: "shop" | "leasing" | "hub";
}) {
  const [user, setUser] = useState<WorkspaceUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const allowed = useCallback(
    (role: string) => {
      if (portal === "hub") return isAdminRole(role);
      if (portal === "leasing") return canAccessLeasingPortal(role);
      return canAccessShopPortal(role);
    },
    [portal],
  );

  useEffect(
    () =>
      deferEffect(() => {
        if (!readToken("admin")) {
          writeToken("admin", null);
          setUser(null);
          setLoading(false);
          return;
        }
        adminApi
          .me()
          .then((me) => {
            setUser(me);
            writeToken("admin", readToken("admin"));
          })
          .catch(() => {
            writeToken("admin", null);
            setUser(null);
          })
          .finally(() => setLoading(false));
      }),
    [],
  );

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace(profileLoginPath(pathname));
      return;
    }
    if (!allowed(user.role)) {
      router.replace(workspaceHome(user.role));
    }
  }, [user, loading, router, pathname, allowed]);

  const signOut = useCallback(() => {
    void adminApi.logout().catch(() => undefined);
    void api.logout().catch(() => undefined);
    writeToken("admin", null);
    writeToken("customer", null);
    clearRequestCache();
    clearCheckoutDraft();
    clearCheckoutIdempotencyKey();
    setUser(null);
    router.replace("/profile");
  }, [router]);

  const value = useMemo<AdminSession>(
    () => ({ user, loading, signOut }),
    [user, loading, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdminSession(): AdminSession {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAdminSession нь AdminSessionProvider дотор байх ёстой.");
  return ctx;
}
