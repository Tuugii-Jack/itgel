"use client";

import { BankAccountFields } from "@/components/BankAccountFields";
import { Button, Card } from "@/components/ui";
import { useBankAccountForm } from "@/features/profile/hooks/useBankAccountForm";

export function BankAccountForm() {
  const {
    bankName,
    setBankName,
    bankAccountNumber,
    setBankAccountNumber,
    bankAccountName,
    setBankAccountName,
    saving,
    saved,
    complete,
    saveBank,
  } = useBankAccountForm();

  return (
    <Card className='mb-4 p-4 lg:p-5'>
      <div className='mb-4'>
        <div className='text-[15px] font-medium'>Буцаалтын данс</div>
        <p className='mt-1 mb-0 text-[13px] text-muted'>
          Бараа буцаахад мөнгө энэ данс руу орно. Админ буцаалт болон таны мэдээлэл дээр харна.
        </p>
      </div>

      <BankAccountFields
        bankName={bankName}
        accountNumber={bankAccountNumber}
        accountName={bankAccountName}
        onBankName={setBankName}
        onAccountNumber={setBankAccountNumber}
        onAccountName={setBankAccountName}
      />

      <div className='mt-4 flex items-center justify-between gap-3'>
        <span className='text-[12px] text-muted'>
          {saved ? "Өөрчлөлт хадгалагдлаа." : "Хадгалсны дараа буцаалтад ашиглагдана."}
        </span>
        <Button size='sm' onClick={() => void saveBank()} loading={saving} disabled={!complete}>
          Хадгалах
        </Button>
      </div>
    </Card>
  );
}
