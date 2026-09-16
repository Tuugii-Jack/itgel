"use client";

import { Card, Toggle } from "@/components/ui";
import { useNotificationToggles } from "@/features/profile/hooks/useNotificationToggles";

export function NotificationToggles() {
  const { notif, toggle } = useNotificationToggles();

  return (
    <Card className='flex flex-col gap-1 p-4 lg:gap-2 lg:p-6'>
      <div className='mb-1 text-[15px] font-medium'>Мэдэгдэл</div>
      <Toggle
        label='Төлбөр баталгаажсан'
        hint='Mail-ээр мэдэгдэнэ'
        checked={notif.payment}
        onChange={(v) => toggle("notifyPayment", "payment", v)}
      />
      <Toggle
        label='Бараа ирсэн'
        hint='Mail-ээр мэдэгдэнэ'
        checked={notif.arrival}
        onChange={(v) => toggle("notifyArrival", "arrival", v)}
      />
    </Card>
  );
}
