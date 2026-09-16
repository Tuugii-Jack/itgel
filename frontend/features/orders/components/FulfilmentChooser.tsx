"use client";

import { useState } from "react";
import { Button, ErrorNote, Textarea } from "@/components/ui";
import { PaymentPanel } from "@/features/payments/components/PaymentPanel";
import { LocationFields } from "@/components/LocationFields";
import { api, ApiError } from "@/lib/api";
import { UB_DISTRICTS } from "@/lib/locations";
import { useSession } from "@/lib/session";
import { money } from "@/lib/format";
import { itemNeedsFulfilment } from "@/lib/fulfilment";
import { leasingHoldsGoods } from "@/lib/leasing";
import { useToast } from "@/lib/toast";
import type { PublicOrder, Store } from "@/lib/types";
import { FulfilmentItemRow } from "./FulfilmentItemRow";
import { FulfilmentField, FulfilmentOptionCard } from "./FulfilmentUi";
import { FulfilmentSummary } from "./FulfilmentSummary";
import { lineCargo, unpaidTowardCargo } from "../lib/cargo";
import { pruneSelectedIds } from "@/lib/selectedIds";

/**
 * 06 Бараа ирсэн — авах арга сонгох.
 *
 * Чек хийсэн бараанд доорх арга хамаарна. Карго ирж авахад ч тооцогдоно;
 * хүргэлтээр үлдсэн каргог QPay-ээр төлнө.
 */
export function FulfilmentChooser({
  order,
  store,
  onDone,
}: {
  order: PublicOrder;
  store: Store;
  onDone: (more?: boolean) => void;
}) {
  const session = useSession();
  const toast = useToast();
  const [type, setType] = useState<"PICKUP" | "DELIVERY">("PICKUP");
  const [district, setDistrict] = useState<string | null>(null);
  const [khoroo, setKhoroo] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awaitingQpay, setAwaitingQpay] = useState<(PublicOrder & { stay?: boolean }) | null>(
    null,
  );

  const namedDistricts = store.deliveryDistricts ?? [];
  const districts =
    namedDistricts.length > 0
      ? namedDistricts
      : store.deliveryFees.map((d) => d.district);

  const liveItems = order.items.filter((i) => !i.cancelled);
  const pendingItems = liveItems.filter(itemNeedsFulfilment);
  const chosenItems = liveItems.filter(
    (i) =>
      i.fulfilment &&
      (i.itemStatus === "arrived" ||
        i.itemStatus === "handed_over" ||
        (i.arrivedQty ?? 0) > 0),
  );
  const waitingItems = liveItems.filter(
    (i) =>
      i.itemStatus !== "arrived" &&
      i.itemStatus !== "handed_over" &&
      (i.arrivedQty ?? 0) <= 0,
  );

  const pendingKey = pendingItems.map((i) => i.id).sort().join(",");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [seenPendingKey, setSeenPendingKey] = useState(pendingKey);
  if (pendingKey !== seenPendingKey) {
    setSeenPendingKey(pendingKey);
    setSelected(pruneSelectedIds(pendingKey, selected));
  }

  const choose = (next: "PICKUP" | "DELIVERY") => {
    setType(next);
    setError(null);
  };

  const savedAddress = session.me?.address;
  const [seenMe, setSeenMe] = useState(session.me);
  if (session.me !== seenMe) {
    setSeenMe(session.me);
    if (savedAddress) {
      if (savedAddress.district) setDistrict(savedAddress.district);
      if (savedAddress.khoroo) setKhoroo(savedAddress.khoroo);
      if (savedAddress.addressText) setAddress(savedAddress.addressText);
    }
  }

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedCount = pendingItems.filter((i) => selected.has(i.id)).length;

  const allCargo = Math.max(
    order.cargoFee ?? 0,
    liveItems.reduce((sum, item) => sum + lineCargo(item), 0),
  );
  const cargoDue = unpaidTowardCargo(order, allCargo, type === "DELIVERY");
  const needsCargoPay = type === "DELIVERY" && cargoDue > 0;

  const submit = async () => {
    setError(null);
    const itemIds = pendingItems.filter((i) => selected.has(i.id)).map((i) => i.id);
    if (itemIds.length === 0) {
      const message = "Ирсэн бараанаасаа дор хаяж нэгийг чек хийнэ үү.";
      setError(message);
      toast.error(message);
      return;
    }
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
        itemIds,
        ...(type === "DELIVERY"
          ? {
              payMethod: needsCargoPay ? "QPAY" : undefined,
              district: district ?? undefined,
              khoroo: khoroo.trim() || undefined,
              address: address.trim() || undefined,
            }
          : {}),
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
        const storageFee = result.storageFee ?? 0;
        setAwaitingQpay({
          ...order,
          fulfilment: "DELIVERY",
          cargoPayMethod: "QPAY",
          dueAmount: result.dueAmount,
          deliveryFee: result.deliveryFee,
          cargoFee: result.cargoFee ?? order.cargoFee,
          storageFee,
          storage: order.storage ? { ...order.storage, fee: storageFee } : order.storage,
          paymentState: "PARTIAL",
          items: order.items.map((item) =>
            itemIds.includes(item.id) ? { ...item, fulfilment: "DELIVERY" } : item,
          ),
          stay: result.canChooseFulfilment,
        });
        toast.success("QPay-ээр карго төлнө үү.");
        setBusy(false);
        return;
      }

      toast.success(
        result.canChooseFulfilment
          ? "Сонгосон барааны авах арга хадгалагдлаа. Үлдсэнийг дахин сонгоно уу."
          : type === "DELIVERY"
            ? "Хүргэлт сонгогдлоо."
            : "Авах арга хадгалагдлаа.",
      );
      setBusy(false);
      onDone(result.canChooseFulfilment);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Хадгалж чадсангүй.";
      setError(message);
      toast.error(message);
      setBusy(false);
    }
  };

  if (leasingHoldsGoods(order)) {
    return (
      <div className="px-4 pb-24 pt-6 lg:px-10 lg:pb-12 lg:pt-8">
        <div className="tnum text-[13px] text-muted">{order.code}</div>
        <div className="mt-1 text-[24px] font-medium">Лизингийн үлдэгдэл</div>
        <p className="mt-1 mb-5 text-[14px] leading-[1.5] text-ink-2">
          Лизингийн данс тусдаа тул үлдэгдэл төлбөрөө эхлээд төлнө үү. Төлсний
          дараа ирсэн бараагаа авна.
        </p>
        <PaymentPanel
          order={order}
          store={store}
          onClaimed={() => {
            toast.success("Төлбөр орлоо.");
            onDone(true);
          }}
        />
        <div className="mt-4">
          <Button variant="ghost" onClick={() => onDone(false)}>
            Буцах
          </Button>
        </div>
      </div>
    );
  }

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
            onDone(awaitingQpay.stay);
          }}
        />
      </div>
    );
  }

  const submitLabel = needsCargoPay ? "QPay-ээр үргэлжлүүлэх" : "Баталгаажуулах";
  const title =
    pendingItems.length > 0
      ? chosenItems.length > 0
        ? `${pendingItems.length} барааны авах арга`
        : `${pendingItems.length} бараа ирлээ`
      : `${chosenItems.length} бараа ирлээ`;

  return (
    <div className="pb-24 lg:px-10 lg:pb-12 lg:pt-8">
      <div className="px-4 pt-6 lg:max-w-[1120px] lg:px-0 lg:pt-0">
        <div className="tnum text-[13px] text-muted">{order.code}</div>
        <div className="mt-1 text-[24px] font-medium lg:text-[28px]">{title}</div>
        <div className="mt-1 text-[14px] leading-[1.5] text-ink-2 lg:text-[15px]">
          Авах бараагаа чек хийнэ үү. Чек хийсэнд л доорх арга хамаарна — нэгийг
          хүргүүлж, нөгөөг нь очиж авч болно.
          {waitingItems.length > 0 ? " Ирээгүй бараа дараа нь ирнэ." : ""}
        </div>
      </div>

      <div className="lg:mt-7 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-8">
        <div className="lg:flex lg:flex-col lg:gap-6">

      <div className="flex flex-col gap-2 px-4 pt-5 lg:px-0 lg:pt-0">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-[13px] text-ink-2">Ирсэн бараа — чек хийнэ үү</div>
          {pendingItems.length > 1 && (
            <button
              type="button"
              className="text-[13px] text-ink-2 underline-offset-2 hover:underline"
              onClick={() =>
                setSelected(
                  selectedCount === pendingItems.length
                    ? new Set()
                    : new Set(pendingItems.map((item) => item.id)),
                )
              }
            >
              {selectedCount === pendingItems.length ? "Бүгдийг цэвэрлэх" : "Бүгдийг сонгох"}
            </button>
          )}
        </div>
        <div className="overflow-hidden rounded-[12px] border border-line">
          {pendingItems.length === 0 && chosenItems.length === 0 ? (
            <div className="p-3.5 text-[14px] text-muted">Ирсэн бараа алга.</div>
          ) : (
            <>
              {pendingItems.map((item) => (
                <FulfilmentItemRow
                  key={item.id}
                  item={item}
                  mode="check"
                  checked={selected.has(item.id)}
                  onToggle={() => toggle(item.id)}
                />
              ))}
              {chosenItems.map((item) => (
                <FulfilmentItemRow key={item.id} item={item} mode="locked" />
              ))}
            </>
          )}
        </div>
      </div>

      {waitingItems.length > 0 && (
        <div className="flex flex-col gap-2 px-4 pt-5 lg:px-0 lg:pt-0">
          <div className="text-[13px] text-ink-2">Одоогоор ирээгүй</div>
          <div className="overflow-hidden rounded-[12px] border border-line">
            {waitingItems.map((item) => (
              <FulfilmentItemRow key={item.id} item={item} mode="waiting" />
            ))}
          </div>
        </div>
      )}

      <div className="px-4 pt-6 lg:px-0 lg:pt-0">
        <div className="text-[15px] font-medium lg:text-[17px]">
          Сонгосон барааг хэрхэн авах вэ
        </div>
      </div>

      <div className="flex flex-col gap-3 px-4 pt-6 lg:grid lg:grid-cols-2 lg:px-0 lg:pt-3">
        <FulfilmentOptionCard
          selected={type === "PICKUP"}
          onSelect={() => choose("PICKUP")}
          title="Өөрөө ирж авах"
          right={
            cargoDue > 0 ? (
              <span className="tnum whitespace-nowrap text-[14px] text-ink-2">
                Карго {money(cargoDue)}
              </span>
            ) : allCargo > 0 ? (
              <span className="whitespace-nowrap text-[14px] text-ok">Карго төлсөн</span>
            ) : (
              <span className="whitespace-nowrap text-[14px] text-ok"></span>
            )
          }
        >
          <span className="mt-1.5 block text-[14px] leading-[1.5] text-ink-2">{store.address}</span>
          <span className="mt-0.5 block text-[14px] text-ink-2">{store.workHours}</span>
        </FulfilmentOptionCard>

        <FulfilmentOptionCard
          selected={type === "DELIVERY"}
          onSelect={() => choose("DELIVERY")}
          title="Хүргүүлэх"
          right={
            cargoDue > 0 ? (
              <span className="tnum whitespace-nowrap text-[14px] text-ink-2">
                Карго {money(cargoDue)}
              </span>
            ) : allCargo > 0 ? (
              <span className="whitespace-nowrap text-[14px] text-ok">Карго төлсөн</span>
            ) : selectedCount === 0 ? (
              <span className="whitespace-nowrap text-[14px] text-ink-2">Чек хийсэн бараанд</span>
            ) : (
              <span className="whitespace-nowrap text-[14px] text-ink-2">Компани хүргэнэ</span>
            )
          }
        >
          <span className="mt-1.5 block text-[14px] leading-[1.5] text-ink-2">
            Хүргэлтийн төлбөрийг хүргэлтийн компани авна. Үлдсэн каргог QPay-ээр төлнө.
          </span>
        </FulfilmentOptionCard>
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

          <FulfilmentField label="Дэлгэрэнгүй хаяг">
            <Textarea
              value={address}
              onChange={setAddress}
              placeholder="Байр, орц, тоот, чиглүүлэг"
              rows={3}
            />
          </FulfilmentField>
        </div>
      )}

      {error && (
        <div className="px-4 pb-3 lg:px-0 lg:pb-0">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
        </div>

        <FulfilmentSummary
          order={order}
          type={type}
          selectedCount={selectedCount}
          allCargo={allCargo}
          cargoDue={cargoDue}
          needsCargoPay={needsCargoPay}
          submitLabel={submitLabel}
          busy={busy}
          onSubmit={() => void submit()}
        />
      </div>
    </div>
  );
}
