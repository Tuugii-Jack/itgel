"use client";

import { type Dispatch, type SetStateAction } from "react";
import { Button, Card, Field, Input } from "@/components/ui";
import { usePasswordChange } from "@/features/profile/hooks/usePasswordChange";

export function PasswordChangeForm({
  busy,
  setBusy,
}: {
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
}) {
  const {
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    changePassword,
  } = usePasswordChange(setBusy);

  return (
    <Card className='flex flex-col gap-3 p-4 lg:gap-4 lg:p-6'>
      <div className='text-[15px] font-medium'>Нууц үг солих</div>
      <div className='flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-4'>
        <Field label='Одоогийн нууц үг'>
          <Input
            value={currentPassword}
            onChange={setCurrentPassword}
            type='password'
          />
        </Field>
        <Field label='Шинэ нууц үг'>
          <Input
            value={newPassword}
            onChange={setNewPassword}
            type='password'
          />
        </Field>
      </div>
      <Button
        onClick={changePassword}
        loading={busy}
        disabled={currentPassword.length < 1 || newPassword.length < 6}
      >
        Нууц үг хадгалах
      </Button>
    </Card>
  );
}
