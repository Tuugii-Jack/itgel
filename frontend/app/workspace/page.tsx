"use client";

import { Spinner } from "@/components/ui";
import { WorkspaceChooser } from "@/features/auth/components/WorkspaceChooser";
import { isOwner } from "@/lib/admin-role";
import { AdminSessionProvider, useAdminSession } from "@/lib/admin-session";
import { workspaceHome } from "@/lib/safeNext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function WorkspacePage() {
  return (
    <AdminSessionProvider portal="hub">
      <Hub />
    </AdminSessionProvider>
  );
}

function Hub() {
  const { user, loading } = useAdminSession();
  const router = useRouter();

  useEffect(() => {
    if (loading || !user) return;
    if (isOwner(user.role)) return;
    router.replace(workspaceHome(user.role));
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="text-muted" />
      </div>
    );
  }

  if (!isOwner(user.role)) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="text-muted" />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="flex w-full max-w-[420px] flex-col gap-3">
        <div className="text-[20px] font-medium">Хэсэг сонгох</div>
        <p className="m-0 text-[14px] text-ink-2">
          Хүссэн хэсэгтээ орж, дахин нэвтрэлгүйгээр сольж болно.
        </p>
        <WorkspaceChooser role={user.role} destinations={user.destinations} />
      </div>
    </div>
  );
}
