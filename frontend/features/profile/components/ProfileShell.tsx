"use client";

import { useState } from "react";
import { Button, ErrorNote } from "@/components/ui";
import { InfoTab } from "@/features/profile/components/InfoTab";
import { OrdersTab } from "@/features/profile/components/OrdersTab";
import { PaymentsTab } from "@/features/profile/components/PaymentsTab";
import { OrdersSkeleton } from "@/features/profile/components/ProfileSkeletons";
import { useProfile } from "@/features/profile/hooks/useProfile";
import { phoneLabel } from "@/lib/format";
import { useSession } from "@/lib/session";

type Tab = "orders" | "payments" | "info";

export function ProfileShell() {
  const session = useSession();
  const me = session.me!;
  const [tab, setTab] = useState<Tab>("orders");
  const { orders, totals, store, loading, error, load } = useProfile();

  const initial = (me.name ?? me.phone ?? me.email ?? "?").trim().charAt(0).toUpperCase();

  const tabs: [Tab, string][] = [
    ["orders", "Захиалгууд"],
    ["payments", "Данс"],
    ["info", "Мэдээлэл"],
  ];

  return (
    /* Laptop — дизайны 280px хажуугийн цэс, баруун талд агуулга */
    <div className='lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start lg:gap-8 lg:px-10 lg:pt-8'>
      <div className='lg:sticky lg:top-8 lg:flex lg:flex-col lg:gap-4'>
        <div className='flex items-center gap-3 px-4 pt-5 lg:flex-col lg:items-stretch lg:gap-3 lg:rounded-[12px] lg:border lg:border-line lg:p-5 lg:pt-5'>
          <div className='flex min-w-0 flex-1 items-center gap-3 lg:flex-none lg:gap-3.5'>
            <span className='flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-[17px] lg:h-[52px] lg:w-[52px] lg:text-[20px]'>
              {initial}
            </span>
            <div className='min-w-0 flex-1'>
              <div className='truncate text-[15px] lg:text-[16px]'>
                {me.name ?? "Нэр оруулаагүй"}
              </div>
              <div className='tnum text-[13px] text-ink-2 lg:text-muted'>
                {phoneLabel(me.phone)}
              </div>
            </div>
          </div>

          <div className='hidden lg:block lg:h-px lg:bg-line' />

          <div className='lg:hidden'>
            <Button variant='ghost' size='sm' onClick={session.signOut}>
              Гарах
            </Button>
          </div>
        </div>

        {/* Мобайл — хэвтээ таб; laptop — босоо цэс */}
        <div className='flex gap-2 px-4 pt-4 lg:flex-col lg:gap-1.5 lg:px-0 lg:pt-0'>
          {tabs.map(([key, label]) => (
            <button
              key={key}
              type='button'
              onClick={() => setTab(key)}
              className={`h-9 flex-1 cursor-pointer rounded-[8px] border text-[14px] lg:h-11 lg:flex-none lg:px-3.5 lg:text-left lg:text-[15px]
                ${tab === key ? "border-ink bg-ink text-white" : "border-line bg-bg text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          type='button'
          onClick={session.signOut}
          className='hidden h-11 cursor-pointer rounded-[8px] border border-line bg-bg text-[14px] text-ink-2 lg:block'
        >
          Гарах
        </button>
      </div>

      <div className='lg:min-w-0'>
        {error && (
          <div className='px-4 pt-4 lg:px-0 lg:pt-0'>
            <ErrorNote>
              {error}{" "}
              <button
                type='button'
                onClick={() => void load()}
                className='cursor-pointer border-0 bg-transparent p-0 text-danger underline'
              >
                Дахин оролдох
              </button>
            </ErrorNote>
          </div>
        )}
        {loading ? (
          <OrdersSkeleton />
        ) : tab === "orders" ? (
          <OrdersTab orders={orders} activeCount={totals.activeCount} />
        ) : tab === "payments" ? (
          <PaymentsTab />
        ) : (
          <InfoTab store={store} />
        )}
      </div>
    </div>
  );
}
