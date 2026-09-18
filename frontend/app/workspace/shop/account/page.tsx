"use client";

import { PageHead } from "@/components/admin/shared";
import { Card } from "@/components/ui";
import { LoginPhoneCard } from "@/features/auth/components/LoginPhoneCard";

export default function WorkspaceAccountPage() {
  return (
    <div className="max-w-[480px]">
      <PageHead title="Миний бүртгэл" hint="Нэвтрэх утаснаа эндээс солино." />
      <Card className="p-4">
        <LoginPhoneCard />
      </Card>
    </div>
  );
}
