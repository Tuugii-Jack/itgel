"use client";

import { BankAccountForm } from "@/features/profile/components/BankAccountForm";

export function PaymentsTab() {
  return (
    <div className='px-4 pt-4 lg:px-0 lg:pt-0'>
      <div className='mb-3 hidden text-[20px] font-medium lg:block'>Данс</div>

      <BankAccountForm />
    </div>
  );
}
