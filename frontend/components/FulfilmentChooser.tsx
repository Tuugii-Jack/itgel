"use client";

import { useEffect, useState } from "react";
import {
  Button,
  Card,
  ChoiceGroup,
  Divider,
  ErrorNote,
  Input,
  Textarea,
} from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dayKey, money, weekdayShort } from "@/lib/format";
import type { PublicOrder, Slot, Store } from "@/lib/types";

/**
 * «Бараа ирсэн — авах арга сонгох» (дизайны 06).
 * Бүх зүйл нэг дэлгэцэнд, олон алхам болгохгүй.
 */
export function FulfilmentChooser({
  order,
  store,
  onDone,
}: {
  order: PublicOrder;
  store: Store;
  onDone: () => void;
}) {
  const session = useSession();
  const [type, setType] = useState<"PICKUP" | "DELIVERY">("PICKUP");
  const [district, setDistrict] = useState<string | null>(null);
  const [khoroo, setKhoroo] = useState("");
  const [address, setAddress] = useState("");
  const [day, setDay] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .slots(9)
      .then((data) => setSlots(data.slots))
      .catch(() => undefined);
  }, []);

  // Хадгалсан хаяг байвал автоматаар оруулна.
  useEffect(() => {
    const saved = session.me?.address;
    if (!saved) return;
    if (saved.district) setDistrict(saved.district);
    if (saved.khoroo) setKhoroo(saved.khoroo);
    if (saved.addressText) setAddress(saved.addressText);
  }, [session.me]);

  const minFee = store.deliveryFees.length
    ? Math.min(...store.deliveryFees.map((d) => d.fee))
    : 5000;
  const fee =
    type === "DELIVERY" && district
      ? (store.deliveryFees.find((d) => d.district === district)?.fee ?? minFee)
      : 0;
  const total = order.dueAmount + fee;

  const submit = async () => {
    setError(null);
    if (type === "DELIVERY" && (!district || !day)) {
      setError("Дүүрэг болон хүргэлтийн өдрөө сонгоно уу.");
      return;
    }
    setBusy(true);
    try {
      await api.chooseFulfilment(order.code, {
        type,
        district: district ?? undefined,
        khoroo: khoroo || undefined,
        address: address || undefined,
        day: day ?? undefined,
      });
      // Дараагийн удаа автоматаар орохын тулд хаягийг хадгална.
      if (type === "DELIVERY" && session.me) {
        await api
          .updateMe({
            district,
            khoroo: khoroo || null,
            addressText: address || null,
          })
          .catch(() => undefined);
      }
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Хадгалж чадсангүй.");
      setBusy(false);
    }
  };

  return (
    <div className='px-4 pt-5'>
      <div className='mb-1 text-[20px] font-medium'>Таны бараа ирлээ</div>
      <p className='mt-0 mb-3 text-[13px] text-ink-2'>
        Хэрхэн авахаа сонгоно уу. Дараа нь өөрчлөх боломжгүй.
      </p>

      <div className='flex flex-col gap-2'>
        <OptionCard
          selected={type === "PICKUP"}
          onSelect={() => setType("PICKUP")}
          title='Өөрөө ирж авах'
          right={<span className='text-[13px] text-ok'>Үнэгүй</span>}
        >
          <div className='text-[13px] text-ink-2'>{store.address}</div>
          <div className='text-[13px] text-muted'>{store.workHours}</div>
        </OptionCard>

        <OptionCard
          selected={type === "DELIVERY"}
          onSelect={() => setType("DELIVERY")}
          title='Хүргүүлэх'
          right={
            <span className='tnum text-[13px] text-ink-2'>
              {money(minFee)}-с
            </span>
          }
        >
          <div className='text-[13px] text-muted'>Мя, Пү, Бя гаригт</div>
        </OptionCard>
      </div>

      {type === "DELIVERY" && (
        <div className='flex flex-col gap-4 pt-4'>
          <div>
            <div className='mb-2 text-[14px]'>Дүүрэг</div>
            <ChoiceGroup
              options={store.deliveryFees.map((d) => ({
                value: d.district,
                label: d.district,
              }))}
              value={district}
              onChange={setDistrict}
              columns={2}
            />
          </div>

          <div>
            <div className='mb-2 text-[14px]'>Хороо</div>
            <Input
              value={khoroo}
              onChange={setKhoroo}
              placeholder='Жишээ: 15-р хороо'
            />
          </div>

          <div>
            <div className='mb-2 text-[14px]'>Дэлгэрэнгүй хаяг</div>
            <Textarea
              value={address}
              onChange={setAddress}
              placeholder='Байр, орц, тоот, чиглүүлэг'
              rows={3}
            />
          </div>

          <div>
            <div className='mb-2 text-[14px]'>Хүргэлтийн өдөр</div>
            <div className='grid grid-cols-3 gap-2'>
              {slots.map((slot) => {
                const active = day === slot.day;
                return (
                  <button
                    key={slot.day}
                    type='button'
                    disabled={!slot.available}
                    onClick={() => setDay(slot.day)}
                    className={`flex h-[68px] flex-col items-center justify-center rounded-[8px] border px-1 transition-colors
                      ${active ? "border-primary bg-primary text-white" : "border-line bg-bg hover:border-primary-muted"}
                      ${slot.available ? "cursor-pointer" : "opacity-40"}`}
                  >
                    <span className='text-[12px] opacity-70'>
                      {weekdayShort(slot.day)}
                    </span>
                    <span className='tnum text-[15px]'>
                      {Number(slot.day.slice(8))}
                    </span>
                    <span
                      className={`text-[12px] ${active ? "opacity-80" : slot.available ? "text-ok" : "text-muted"}`}
                    >
                      {slot.available ? `${slot.remaining} сул` : "Дүүрсэн"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <Card className='mt-4 flex flex-col gap-2 p-4'>
        <div className='flex items-baseline justify-between gap-2 text-[14px]'>
          <span className='text-ink-2'>Үлдэгдэл төлбөр</span>
          <span className='tnum'>{money(order.dueAmount)}</span>
        </div>
        <div className='flex items-baseline justify-between gap-2 text-[14px]'>
          <span className='text-ink-2'>Хүргэлтийн хураамж</span>
          <span className='tnum'>{fee === 0 ? "Үнэгүй" : money(fee)}</span>
        </div>
        <Divider />
        <div className='flex items-baseline justify-between gap-2'>
          <span className='text-[14px] text-ink-2'>Нийт төлөх</span>
          <span className='tnum text-[20px] font-medium'>{money(total)}</span>
        </div>
      </Card>

      {error && <div className='pt-3'>{<ErrorNote>{error}</ErrorNote>}</div>}

      <Button full size='lg' className='mt-4' onClick={submit} loading={busy}>
        Баталгаажуулах
      </Button>
    </div>
  );
}

function OptionCard({
  selected,
  onSelect,
  title,
  right,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  right: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type='button'
      onClick={onSelect}
      className={`w-full cursor-pointer rounded-[12px] border bg-bg p-4 text-left transition-colors
        ${selected ? "border-primary" : "border-line hover:border-primary-muted"}`}
    >
      <div className='flex items-start gap-3'>
        <span
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border
            ${selected ? "border-primary" : "border-muted"}`}
        >
          {selected && <span className='h-2.5 w-2.5 rounded-full bg-primary' />}
        </span>
        <div className='min-w-0 flex-1'>
          <div className='flex items-baseline justify-between gap-2'>
            <span className='text-[15px] font-medium'>{title}</span>
            {right}
          </div>
          <div className='mt-1 flex flex-col gap-0.5'>{children}</div>
        </div>
      </div>
    </button>
  );
}
