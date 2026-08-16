"use client";

import { useEffect, useState } from "react";
import { Button, ErrorNote, Textarea } from "@/components/ui";
import { PaymentPanel } from "@/components/PaymentPanel";
import { LocationFields } from "@/components/LocationFields";
import { api, ApiError } from "@/lib/api";
import { UB_DISTRICTS } from "@/lib/locations";
import { useSession } from "@/lib/session";
import { money } from "@/lib/format";
import { formatSelections } from "@/lib/options";
import { useToast } from "@/lib/toast";
import type { PublicOrder, Store } from "@/lib/types";

function unpaidCargoFee(order: PublicOrder): number {
  const cargoFee = Math.max(0, order.cargoFee ?? 0);
  if (cargoFee <= 0) return 0;
  const netPaid = order.paidAmount - order.refundedAmount;
  const towardCargo = Math.max(0, netPaid - order.subtotal - (order.storageFee ?? 0));
  return Math.max(0, cargoFee - towardCargo);
}

/**
 * 06 Бараа ирсэн — авах арга сонгох.
 *
 * Хүргэлтээр: үлдсэн карго төлүүлнэ. Очиж авахад карго заавал төлөхгүй.
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
  const toast = useToast();
  const [type, setType] = useState<"PICKUP" | "DELIVERY">("PICKUP");
  const [district, setDistrict] = useState<string | null>(null);
  const [khoroo, setKhoroo] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awaitingQpay, setAwaitingQpay] = useState<PublicOrder | null>(null);

  const cargoFee = order.cargoFee ?? 0;
  const cargoDue = unpaidCargoFee(order);
  const needsCargoPay = type === "DELIVERY" && cargoDue > 0;
  const namedDistricts = store.deliveryDistricts ?? [];
  const districts =
    namedDistricts.length > 0
      ? namedDistricts
      : store.deliveryFees.map((d) => d.district);
  const total = order.dueAmount;

  const choose = (next: "PICKUP" | "DELIVERY") => {
    setType(next);
    setError(null);
  };

  useEffect(() => {
    const saved = session.me?.address;
    if (!saved) return;
    if (saved.district) setDistrict(saved.district);
    if (saved.khoroo) setKhoroo(saved.khoroo);
    if (saved.addressText) setAddress(saved.addressText);
  }, [session.me]);

  const liveItems = order.items.filter((i) => !i.cancelled);

  const submit = async () => {
    setError(null);
    if (type === "DELIVERY" && (!district || !khoroo.trim() || !address.trim())) {
      const message = "Байршил, хороо/сум, хаягаа бөглөнө үү.";
      setError(message);
      toast.error(message);
      return;
    }
    setBusy(true);
    try {
      const result = await api.chooseFulfilment(order.code, {
        type,
        payMethod: needsCargoPay ? "QPAY" : undefined,
        district: district ?? undefined,
        khoroo: khoroo || undefined,
        address: address || undefined,
      });
      if (type === "DELIVERY" && session.me) {
        await api
          .updateMe({
            district,
            khoroo: khoroo || null,
            addressText: address || null,
          })
          .catch(() => undefined);
      }

      if (needsCargoPay && result.dueAmount > 0) {
        setAwaitingQpay({
          ...order,
          fulfilment: "DELIVERY",
          cargoPayMethod: "QPAY",
          dueAmount: result.dueAmount,
          deliveryFee: result.deliveryFee,
          paymentState: "PARTIAL",
        });
        toast.success("QPay-ээр карго төлнө үү.");
        setBusy(false);
        return;
      }

      toast.success(type === "DELIVERY" ? "Хүргэлт сонгогдлоо." : "Авах арга хадгалагдлаа.");
      onDone();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Хадгалж чадсангүй.";
      setError(message);
      toast.error(message);
      setBusy(false);
    }
  };

  if (awaitingQpay) {
    return (
      <div className="px-4 pb-24 pt-6 lg:px-10 lg:pb-12 lg:pt-8">
        <div className="tnum text-[13px] text-muted">{order.code}</div>
        <div className="mt-1 text-[24px] font-medium">Карго төлөх</div>
        <p className="mt-1 mb-5 text-[14px] text-ink-2">
          Хүргэлтээр авахад карго {money(awaitingQpay.dueAmount)}-г QPay-ээр төлнө үү.
        </p>
        <PaymentPanel
          order={awaitingQpay}
          store={store}
          onClaimed={() => {
            toast.success("Төлбөр орлоо.");
            onDone();
          }}
        />
      </div>
    );
  }

  const submitLabel = needsCargoPay ? "QPay-ээр үргэлжлүүлэх" : "Баталгаажуулах";

  return (
    <div className="pb-24 lg:px-10 lg:pb-12 lg:pt-8">
      <div className="px-4 pt-6 lg:max-w-[1120px] lg:px-0 lg:pt-0">
        <div className="tnum text-[13px] text-muted">{order.code}</div>
        <div className="mt-1 text-[24px] font-medium lg:text-[28px]">
          {liveItems.length} бараа ирлээ
        </div>
        <div className="mt-1 text-[14px] leading-[1.5] text-ink-2 lg:text-[15px]">
          Хэрхэн авахаа сонгоно уу. Хүргэлтээр авахад үлдсэн каргог QPay-ээр төлнө.
        </div>
      </div>

      <div className="lg:mt-7 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-8">
        <div className="lg:flex lg:flex-col lg:gap-6">

      <div className="flex flex-col gap-2 px-4 pt-5 lg:px-0 lg:pt-0">
        <div className="text-[13px] text-ink-2">Ирсэн бараа</div>
        <div className="overflow-hidden rounded-[12px] border border-line">
          {liveItems.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 border-b border-line p-3.5 last:border-b-0"
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded-[4px] border border-ok bg-ok-bg">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#15803D" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.5 6.2 L4.8 8.5 L9.5 3.5" />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px]">{item.name}</span>
                <span className="block text-[13px] text-muted">
                  {formatSelections(item.selections, item.size, item.color)}
                  {formatSelections(item.selections, item.size, item.color) ? " · " : ""}
                  {item.qty} ш
                </span>
              </span>
              <span className="tnum shrink-0 text-[14px]">{money(item.total)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="px-4 pt-6 lg:px-0 lg:pt-0">
        <div className="text-[15px] font-medium lg:text-[17px]">Авах аргаа сонгоно уу</div>
      </div>

      <div className="flex flex-col gap-3 px-4 pt-6 lg:grid lg:grid-cols-2 lg:px-0 lg:pt-3">
        <OptionCard
          selected={type === "PICKUP"}
          onSelect={() => choose("PICKUP")}
          title="Өөрөө ирж авах"
          right={<span className="whitespace-nowrap text-[14px] text-ok">Карго төлөхгүй</span>}
        >
          <span className="mt-1.5 block text-[14px] leading-[1.5] text-ink-2">{store.address}</span>
          <span className="mt-0.5 block text-[14px] text-ink-2">{store.workHours}</span>
        </OptionCard>

        <OptionCard
          selected={type === "DELIVERY"}
          onSelect={() => choose("DELIVERY")}
          title="Хүргүүлэх"
          right={
            cargoDue > 0 ? (
              <span className="tnum whitespace-nowrap text-[14px] text-ink-2">
                Карго {money(cargoDue)}
              </span>
            ) : cargoFee > 0 ? (
              <span className="whitespace-nowrap text-[14px] text-ok">Карго төлсөн</span>
            ) : (
              <span className="whitespace-nowrap text-[14px] text-ink-2">Компани хүргэнэ</span>
            )
          }
        >
          <span className="mt-1.5 block text-[14px] leading-[1.5] text-ink-2">
            Хүргэлтийн төлбөрийг хүргэлтийн компани авна. Үлдсэн каргог QPay-ээр төлнө.
          </span>
        </OptionCard>
      </div>

      {type === "DELIVERY" && (
        <div className="flex flex-col gap-6 px-4 pt-6 lg:rounded-[12px] lg:border lg:border-line lg:px-6 lg:py-6 lg:pt-6">
          <LocationFields
            cityDistricts={districts.length > 0 ? districts : UB_DISTRICTS}
            district={district}
            onDistrictChange={setDistrict}
            khoroo={khoroo}
            onKhorooChange={setKhoroo}
          />

          <Field label="Дэлгэрэнгүй хаяг">
            <Textarea
              value={address}
              onChange={setAddress}
              placeholder="Байр, орц, тоот, чиглүүлэг"
              rows={3}
            />
          </Field>
        </div>
      )}

      {error && (
        <div className="px-4 pb-3 lg:px-0 lg:pb-0">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
        </div>

        <div className="px-4 pb-6 pt-6 lg:sticky lg:top-6 lg:flex lg:flex-col lg:gap-4 lg:rounded-[12px] lg:border lg:border-line lg:p-6">
          <div className="hidden text-[17px] font-medium lg:block">Хураангуй</div>
          <div className="tnum flex flex-col gap-2.5 rounded-[12px] border border-line p-3.5 text-[14px] lg:rounded-none lg:border-0 lg:p-0">
            <Row label="Одоо авах" value={`${liveItems.length} бараа`} />
            <Row
              label="Барааны төлбөр"
              value={order.subtotal <= order.paidAmount - order.refundedAmount ? "Төлөгдсөн" : money(Math.max(0, order.subtotal - (order.paidAmount - order.refundedAmount)))}
              ok={order.subtotal <= order.paidAmount - order.refundedAmount}
            />
            {cargoFee > 0 && (
              <Row
                label="Карго"
                value={
                  type === "PICKUP"
                    ? cargoDue > 0
                      ? "Одоо төлөхгүй"
                      : "Төлсөн"
                    : cargoDue > 0
                      ? money(cargoDue)
                      : "Төлсөн"
                }
                ok={type === "PICKUP" || cargoDue <= 0}
              />
            )}
            {(order.storageFee ?? 0) > 0 && (
              <Row label="Агуулахын хураамж" value={money(order.storageFee)} />
            )}
            {type === "DELIVERY" && (
              <div className="text-[13px] leading-[1.45] text-ink-2">
                Хүргэлтийн төлбөрийг хүргэлтийн компани өөрөө авна.
              </div>
            )}
            {needsCargoPay && (
              <>
                <div className="h-px bg-line" />
                <div className="flex justify-between gap-3 text-[17px] font-medium lg:text-[20px]">
                  <span>QPay-ээр төлөх</span>
                  <span>{money(total)}</span>
                </div>
              </>
            )}
          </div>

          <div className="hidden lg:block">
            <Button full size="bar" onClick={submit} loading={busy}>
              {submitLabel}
            </Button>
          </div>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-[560px] border-t border-line bg-bg px-4 py-3 lg:hidden">
        <Button full size="bar" onClick={submit} loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[14px] text-ink-2">{label}</div>
      {children}
    </div>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-ink-2">{label}</span>
      <span className={ok ? "text-ok" : ""}>{value}</span>
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
      type="button"
      onClick={onSelect}
      className={`flex w-full cursor-pointer gap-3 rounded-[12px] border p-4 text-left
        ${selected ? "border-ink bg-surface" : "border-line bg-bg"}`}
    >
      <span
        className={`mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border bg-bg
          ${selected ? "border-ink" : "border-line"}`}
      >
        {selected && <span className="size-[9px] rounded-full bg-ink" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-[17px] text-ink">{title}</span>
          {right}
        </span>
        {children}
      </span>
    </button>
  );
}
