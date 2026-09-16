"use client";

import { useState } from "react";
import { Button, Card, ErrorNote } from "@/components/ui";
import { EmailChangeForm } from "@/features/profile/components/EmailChangeForm";
import { NotificationToggles } from "@/features/profile/components/NotificationToggles";
import { PasswordChangeForm } from "@/features/profile/components/PasswordChangeForm";
import { PhoneChangeForm } from "@/features/profile/components/PhoneChangeForm";
import {
  AddressCard,
  PersonalInfoCard,
} from "@/features/profile/components/ProfileDetailsForm";
import { useProfileDetailsForm } from "@/features/profile/hooks/useProfileDetailsForm";
import { useSession } from "@/lib/session";
import type { Me, Store } from "@/lib/types";

export function InfoTab({ store }: { store: Store | null }) {
  const session = useSession();
  const me = session.me!;
  const details = useProfileDetailsForm();
  const [credBusy, setCredBusy] = useState(false);

  return (
    <div className='flex flex-col gap-4 px-4 pt-4 lg:max-w-[720px] lg:gap-5 lg:px-0 lg:pt-0'>
      <div className='hidden text-[20px] font-medium lg:block'>Мэдээлэл</div>

      <PersonalInfoCard me={me} name={details.name} onName={details.setName} />

      <BankSummaryCard me={me} />

      {me.hasPassword && (
      <PasswordChangeForm busy={credBusy} setBusy={setCredBusy} />
      )}

      <EmailChangeForm busy={credBusy} setBusy={setCredBusy} />

      <PhoneChangeForm busy={credBusy} setBusy={setCredBusy} />

      <AddressCard
        store={store}
        district={details.district}
        onDistrict={details.setDistrict}
        khoroo={details.khoroo}
        onKhoroo={details.setKhoroo}
        addressText={details.addressText}
        onAddressText={details.setAddressText}
      />

      <NotificationToggles />

      {details.error && <ErrorNote>{details.error}</ErrorNote>}

      <Button full onClick={details.save} loading={details.saving}>
        {details.saved ? "Хадгалсан ✓" : "Хадгалах"}
      </Button>
    </div>
  );
}

function BankSummaryCard({ me }: { me: Me }) {
  return (
    <Card className='flex flex-col gap-3 p-4 lg:gap-4 lg:p-6'>
      <div className='text-[15px] font-medium'>Буцаалтын данс</div>
      {me.bank?.accountNumber ? (
        <div className='flex flex-col gap-1.5 text-[14px]'>
          <div>{me.bank.name || "Банк сонгоогүй"}</div>
          <div className='tnum'>{me.bank.accountNumber}</div>
          <div className='text-ink-2'>{me.bank.accountName || "Дансны нэр алга"}</div>
          <p className='mb-0 mt-1 text-[13px] text-muted'>
            Засах бол «Данс» хэсэгт орно уу.
          </p>
        </div>
      ) : (
        <p className='m-0 text-[13px] text-muted'>
          Данс хадгалаагүй байна. «Данс» хэсэгт банк, дугаар, нэрээ оруулна уу. Буцаалт энэ
          данс руу орно.
        </p>
      )}
    </Card>
  );
}
