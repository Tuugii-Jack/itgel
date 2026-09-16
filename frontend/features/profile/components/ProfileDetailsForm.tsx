"use client";

import { LocationFields } from "@/components/LocationFields";
import { Card, Field, Input, Textarea } from "@/components/ui";
import { phoneLabel } from "@/lib/format";
import { UB_DISTRICTS } from "@/lib/locations";
import type { Me, Store } from "@/lib/types";

export function PersonalInfoCard({
  me,
  name,
  onName,
}: {
  me: Me;
  name: string;
  onName: (value: string) => void;
}) {
  return (
    <Card className='flex flex-col gap-3 p-4 lg:gap-4 lg:p-6'>
      <div className='text-[15px] font-medium'>Хувийн мэдээлэл</div>
      <div className='flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-4'>
        <Field label='Нэр'>
          <Input value={name} onChange={onName} placeholder='Овог, нэр' />
        </Field>
        <Field label='И-мэйл' hint='Нэвтрэлтэд хэрэггүй — баримт, холбоо барихад'>
          <div className='flex h-11 items-center justify-between rounded-[8px] border border-line bg-surface px-3'>
            <span className='truncate text-[15px]'>{me.email ?? "Нэмээгүй"}</span>
            {me.email ? (
              <span
                className={`shrink-0 text-[13px] ${me.emailVerified ? "text-ok" : "text-warn"}`}
              >
                {me.emailVerified ? "Баталгаажсан" : "Хүлээгдэж буй"}
              </span>
            ) : null}
          </div>
        </Field>
        <Field label='Утас' hint='Нэвтрэх дугаар — солих бол доорх хэсэгт'>
          <div className='flex h-11 items-center rounded-[8px] border border-line bg-surface px-3'>
            <span className='truncate text-[15px]'>
              {me.phone ? phoneLabel(me.phone) : "Нэмээгүй"}
            </span>
          </div>
        </Field>
      </div>
    </Card>
  );
}

export function AddressCard({
  store,
  district,
  onDistrict,
  khoroo,
  onKhoroo,
  addressText,
  onAddressText,
}: {
  store: Store | null;
  district: string;
  onDistrict: (value: string) => void;
  khoroo: string;
  onKhoroo: (value: string) => void;
  addressText: string;
  onAddressText: (value: string) => void;
}) {
  return (
    <Card className='flex flex-col gap-3 p-4 lg:gap-4 lg:p-6'>
      <div>
        <div className='text-[15px] font-medium'>Хадгалсан хаяг</div>
        <p className='mt-0.5 mb-0 text-[13px] text-muted'>
          Хүргэлт сонгоход автоматаар орно
        </p>
      </div>
      <LocationFields
        cityDistricts={
          store?.deliveryDistricts && store.deliveryDistricts.length > 0
            ? store.deliveryDistricts
            : UB_DISTRICTS
        }
        district={district || null}
        onDistrictChange={(v) => onDistrict(v ?? "")}
        khoroo={khoroo}
        onKhorooChange={onKhoroo}
      />
      <Field label='Дэлгэрэнгүй'>
        <Textarea
          value={addressText}
          onChange={onAddressText}
          placeholder='Байр, орц, тоот'
          rows={2}
        />
      </Field>
    </Card>
  );
}
