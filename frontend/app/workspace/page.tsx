"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui";
import { AdminSessionProvider, useAdminSession } from "@/lib/admin-session";
import { workspaceHome } from "@/lib/safeNext";

export default function WorkspacePage() {
  return (
    <AdminSessionProvider portal="hub">
      <Redirect />
    </AdminSessionProvider>
  );
}

function Redirect() {
  const { user, loading } = useAdminSession();
  const router = useRouter();

  useEffect(() => {
    if (loading || !user) return;
    router.replace(workspaceHome(user.role));
  }, [loading, user, router]);

  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Spinner className="text-muted" />
    </div>
  );
}
