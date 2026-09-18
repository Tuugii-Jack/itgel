"use client";

import { PageHead } from "@/components/admin/shared";
import { Card } from "@/components/ui";
import { LoginPhoneCard } from "@/features/auth/components/LoginPhoneCard";
import { useAdminSession } from "@/lib/admin-session";

export default function WorkspaceAccountPage() {
  const { user } = useAdminSession();
  return (
    <div className="max-w-[480px]">
      <PageHead title="Миний бүртгэл" hint="Шинэ нэвтрэх дугаар OTP-оор нэмэгдэнэ. Хуучин дугаарыг солихгүй." />
      <Card className="p-4">
        <LoginPhoneCard phones={user?.loginPhones} />
      </Card>
    </div>
  );
}
