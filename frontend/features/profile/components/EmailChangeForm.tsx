"use client";

import { type Dispatch, type SetStateAction } from "react";
import { Button, Card, Field, Input } from "@/components/ui";
import { useEmailChange } from "@/features/profile/hooks/useEmailChange";

export function EmailChangeForm({
  busy,
  setBusy,
}: {
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
}) {
  const {
    newEmail,
    setNewEmail,
    emailPassword,
    setEmailPassword,
    emailCode,
    setEmailCode,
    emailStep,
    setEmailStep,
    requestEmailChange,
    confirmEmailChange,
    hasPassword,
    email,
  } = useEmailChange(setBusy);

  return (
    <Card className='flex flex-col gap-3 p-4 lg:gap-4 lg:p-6'>
      <div className='text-[15px] font-medium'>
        {email ? "И-мэйл солих" : "И-мэйл нэмэх"}
      </div>
      {emailStep === "form" ? (
        <>
          <div className='flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-4'>
            <Field label={email ? "Шинэ и-мэйл" : "И-мэйл"}>
              <Input value={newEmail} onChange={setNewEmail} type='email' />
            </Field>
            {hasPassword && (
              <Field label='Одоогийн нууц үг'>
                <Input
                  value={emailPassword}
                  onChange={setEmailPassword}
                  type='password'
                />
              </Field>
            )}
          </div>
          <Button
            onClick={requestEmailChange}
            loading={busy}
            disabled={
              !newEmail.trim() || (hasPassword && emailPassword.length < 1)
            }
          >
            Код илгээх
          </Button>
        </>
      ) : (
        <>
          <Field label='Баталгаажуулах код'>
            <Input
              value={emailCode}
              onChange={(v) => setEmailCode(v.replace(/\D/g, "").slice(0, 6))}
              inputMode='numeric'
              maxLength={6}
            />
          </Field>
          <div className='flex gap-2'>
            <Button
              onClick={confirmEmailChange}
              loading={busy}
              disabled={emailCode.length !== 6}
            >
              Баталгаажуулах
            </Button>
            <Button
              variant='ghost'
              onClick={() => setEmailStep("form")}
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
