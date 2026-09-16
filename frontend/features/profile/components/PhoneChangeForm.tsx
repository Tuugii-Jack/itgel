"use client";

import { type Dispatch, type SetStateAction } from "react";
import { Button, Card, Field, Input } from "@/components/ui";
import { usePhoneChange } from "@/features/profile/hooks/usePhoneChange";
import { phoneLabel } from "@/lib/format";

export function PhoneChangeForm({
  busy,
  setBusy,
}: {
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
}) {
  const {
    newPhone,
    setNewPhone,
    phoneCode,
    setPhoneCode,
    phoneStep,
    setPhoneStep,
    requestPhoneChange,
    resendPhoneChange,
    confirmPhoneChange,
    phone,
  } = usePhoneChange(setBusy);

  return (
    <Card className='flex flex-col gap-3 p-4 lg:gap-4 lg:p-6'>
      <div className='text-[15px] font-medium'>
        {phone ? "Утас солих" : "Утас нэмэх"}
      </div>
      <p className='m-0 text-[13px] text-muted'>
        Шинэ дугаар руу код очно. Баталгаажуулах хүртэл одоогийн дугаар хэвээр.
      </p>
      {phoneStep === "form" ? (
        <>
          <Field label={phone ? "Шинэ утас" : "Утас"}>
            <Input
              value={newPhone}
              onChange={(v) => setNewPhone(v.replace(/\D/g, "").slice(0, 8))}
              inputMode='numeric'
              placeholder='99119911'
            />
          </Field>
          <Button
            onClick={() => void requestPhoneChange()}
            loading={busy}
            disabled={newPhone.length !== 8}
          >
            Код илгээх
          </Button>
        </>
      ) : (
        <>
          <Field label='Баталгаажуулах код' hint={phoneLabel(newPhone)}>
            <Input
              value={phoneCode}
              onChange={(v) => setPhoneCode(v.replace(/\D/g, "").slice(0, 6))}
              inputMode='numeric'
              maxLength={6}
            />
          </Field>
          <div className='flex flex-wrap gap-2'>
            <Button
              onClick={() => void confirmPhoneChange()}
              loading={busy}
              disabled={phoneCode.length !== 6}
            >
              Баталгаажуулах
            </Button>
            <Button
              variant='ghost'
              onClick={() => void resendPhoneChange()}
              disabled={busy}
            >
              Дахин код авах
            </Button>
            <Button
              variant='ghost'
              onClick={() => {
                setPhoneStep("form");
                setPhoneCode("");
              }}
              disabled={busy}
            >
              Болих
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
