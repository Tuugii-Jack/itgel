"use client";

import { ItgelWorkspace } from "@/features/leasing/settlements/ItgelWorkspace";
import { canWriteLeasingMoney, isOwner } from "@/lib/admin-role";
import { useAdminSession } from "@/lib/admin-session";

export default function LeasingItgelPage() {
  const { user } = useAdminSession();
  return (
    <ItgelWorkspace
      key={user?.id ?? "leasing-itgel"}
      variant="leasing"
      canPay={canWriteLeasingMoney(user?.role)}
      canConfirmBank={false}
      showOwnerFilter={isOwner(user?.role)}
      canWriteOrder={canWriteLeasingMoney(user?.role)}
    />
  );
}
