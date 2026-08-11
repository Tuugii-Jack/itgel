"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Divider,
  Empty,
  ErrorNote,
  Field,
  Input,
  Spinner,
  Textarea,
  Toggle,
  type Tone,
} from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dayLabel, money, phoneLabel } from "@/lib/format";
import { awaitingPayment, PAYMENT_LABEL, PAYMENT_TONE } from "@/lib/payment";
import type { MyOrder, OrderStatus, Store } from "@/lib/types";

const STATUS_TONE: Record<OrderStatus, Tone> = {
  NEW: "neutral",
  CONFIRMED: "info",
  IN_BATCH: "info",
  IN_TRANSIT: "info",
  ARRIVED: "ok",
  HANDED_OVER: "ok",
  CANCELLED: "danger",
};

type Tab = "orders" | "payments" | "info";

export default function ProfilePage() {
  const session = useSession();

  if (session.loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="text-muted" />
      </div>
    );
  }

  return (
    <div className="screen pb-12">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-bg px-3 py-3 lg:hidden">
        <Link href="/" aria-label="Нүүр" className="no-underline">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#1C1917" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 4 L6 10 L12 16" />
          </svg>
        </Link>
        <span className="text-[15px]">Миний профайл</span>
      </div>

      {session.me ? <Profile /> : <SignIn />}
    </div>
  );
}

/** Утас → код → нэвтрэлт. Бүртгэл үүсгэх шаардлагагүй. */
function SignIn() {
  const session = useSession();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const send = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await api.sendOtp(phone);
      setDevCode(result.devCode ?? null);
      setCooldown(result.resendAfterSec);
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Код илгээж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await api.verifyOtp(phone, code);
      await session.signIn(result.token);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Код шалгаж чадсангүй.");
      setBusy(false);
    }
  };

  return (
    <div className="px-4 pt-6">
      <Card className="flex flex-col gap-3 p-4">
        {!sent ? (
          <>
            <div>
              <div className="text-[15px] font-medium">Утасны дугаараа оруулна уу</div>
              <p className="mt-1 mb-0 text-[13px] text-ink-2">
                Тухайн дугаараар өгсөн захиалга, төлбөрийн түүх харагдана. Бүртгэл үүсгэх
                шаардлагагүй.
              </p>
            </div>
            <Input
              value={phone}
              onChange={(v) => setPhone(v.replace(/\D/g, "").slice(0, 8))}
              placeholder="8 оронтой дугаар"
              inputMode="numeric"
              maxLength={8}
            />
            {error && <ErrorNote>{error}</ErrorNote>}
            <Button full onClick={send} disabled={phone.length !== 8} loading={busy}>
              Код авах
            </Button>
          </>
        ) : (
          <>
            <div>
              <div className="text-[15px] font-medium">Кодоо оруулна уу</div>
              <p className="mt-1 mb-0 text-[13px] text-ink-2">
                <span className="tnum">{phoneLabel(phone)}</span> дугаар руу 4 оронтой код
                илгээлээ.
              </p>
            </div>
            <Input
              value={code}
              onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 4))}
              placeholder="0000"
              inputMode="numeric"
              maxLength={4}
              autoFocus
            />
            {devCode && (
              <p className="m-0 text-[12px] text-muted">
                Туршилтын код: <span className="tnum">{devCode}</span>
              </p>
            )}
            {error && <ErrorNote>{error}</ErrorNote>}
            <Button full onClick={verify} disabled={code.length !== 4} loading={busy}>
              Нэвтрэх
            </Button>
            <div className="flex items-center justify-between text-[13px]">
              <button
                type="button"
                onClick={() => {
                  setSent(false);
                  setCode("");
                }}
                className="cursor-pointer border-0 bg-transparent p-0 text-ink-2 underline"
              >
                Дугаар солих
              </button>
              <span className="tnum text-muted">
                {cooldown > 0 ? `${cooldown} сек` : "Дахин илгээж болно"}
              </span>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function Profile() {
  const session = useSession();
  const me = session.me!;
  const [tab, setTab] = useState<Tab>("orders");
  const [orders, setOrders] = useState<MyOrder[]>([]);
  const [totals, setTotals] = useState({ totalSpent: 0, activeCount: 0 });
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [result, s] = await Promise.all([api.myOrders(), api.store()]);
      setOrders(result.data);
      setTotals({ totalSpent: result.meta.totalSpent, activeCount: result.meta.activeCount });
      setStore(s);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const initial = (me.name ?? me.phone).trim().charAt(0).toUpperCase();

  const tabs: [Tab, string][] = [
    ["orders", "Захиалга"],
    ["payments", "Төлбөр"],
    ["info", "Мэдээлэл"],
  ];

  return (
    /* Laptop — дизайны 280px хажуугийн цэс, баруун талд агуулга */
    <div className="lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start lg:gap-8 lg:px-10 lg:pt-8">
      <div className="lg:sticky lg:top-8 lg:flex lg:flex-col lg:gap-4">
        <div className="flex items-center gap-3 px-4 pt-5 lg:flex-col lg:items-stretch lg:gap-3 lg:rounded-[12px] lg:border lg:border-line lg:p-5 lg:pt-5">
          <div className="flex min-w-0 flex-1 items-center gap-3 lg:flex-none lg:gap-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-[17px] lg:h-[52px] lg:w-[52px] lg:text-[20px]">
              {initial}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] lg:text-[16px]">
                {me.name ?? "Нэр оруулаагүй"}
              </div>
              <div className="tnum text-[13px] text-ink-2 lg:text-muted">
                {phoneLabel(me.phone)}
              </div>
            </div>
          </div>

          <div className="hidden lg:block lg:h-px lg:bg-line" />
          <div className="hidden lg:flex lg:items-baseline lg:justify-between lg:gap-3">
            <span className="text-[13px] text-muted">Нийт төлсөн</span>
            <span className="tnum text-[17px] font-medium">{money(totals.totalSpent)}</span>
          </div>

          <div className="lg:hidden">
            <Button variant="ghost" size="sm" onClick={session.signOut}>
              Гарах
            </Button>
          </div>
        </div>

        {/* Мобайл — хэвтээ таб; laptop — босоо цэс */}
        <div className="flex gap-2 px-4 pt-4 lg:flex-col lg:gap-1.5 lg:px-0 lg:pt-0">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`h-9 flex-1 cursor-pointer rounded-[8px] border text-[14px] lg:h-11 lg:flex-none lg:px-3.5 lg:text-left lg:text-[15px]
                ${tab === key ? "border-ink bg-ink text-white" : "border-line bg-bg text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={session.signOut}
          className="hidden h-11 cursor-pointer rounded-[8px] border border-line bg-bg text-[14px] text-ink-2 lg:block"
        >
          Гарах
        </button>
      </div>

      <div className="lg:min-w-0">
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner className="text-muted" />
          </div>
        ) : tab === "orders" ? (
          <OrdersTab orders={orders} activeCount={totals.activeCount} />
        ) : tab === "payments" ? (
          <PaymentsTab orders={orders} totalSpent={totals.totalSpent} store={store} />
        ) : (
          <InfoTab />
        )}
      </div>
    </div>
  );
}

function OrdersTab({ orders, activeCount }: { orders: MyOrder[]; activeCount: number }) {
  if (orders.length === 0) {
    return <Empty>Захиалга алга байна.</Empty>;
  }

  return (
    <div className="px-4 pt-4 lg:px-0 lg:pt-0">
      <div className="mb-3 flex items-baseline justify-between gap-4 text-[13px] text-ink-2">
        <span className="hidden text-[20px] font-medium text-ink lg:block">Захиалга</span>
        <span>
          {activeCount > 0 ? `${activeCount} захиалга явагдаж байна` : "Идэвхтэй захиалга алга"}
        </span>
      </div>

      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-4">
        {orders.map((order) => {
          const eta = order.timeline.find((s) => s.key === "arrived");
          const etaValue = eta?.at ?? eta?.estimatedAt;
          return (
            <Link key={order.code} href={`/t/${order.code}`} className="no-underline">
              <Card className="h-full p-4 lg:p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="tnum text-[15px] font-medium lg:text-[18px] lg:font-normal">
                      {order.code}
                    </div>
                    <div className="text-[13px] text-muted">
                      {dayLabel(order.createdAt)} · {order.itemCount} бараа
                    </div>
                  </div>
                  <Badge tone={STATUS_TONE[order.status]}>{order.statusLabel}</Badge>
                </div>

                <div className="mt-3 flex gap-1">
                  {order.timeline
                    .filter((s) => s.key !== "cancelled")
                    .map((step) => (
                      <span
                        key={step.key}
                        className={`h-1 flex-1 rounded-full
                          ${step.status === "done" ? "bg-ink" : step.status === "current" ? "bg-info" : "bg-line"}`}
                      />
                    ))}
                </div>

                <Divider className="my-3" />

                <div className="flex items-baseline justify-between gap-2 text-[13px]">
                  <span className="text-muted">
                    {order.status === "HANDED_OVER" ? "Хүлээлгэн өгсөн" : "Гарт очих"}
                  </span>
                  <span className="tnum">
                    {order.status === "HANDED_OVER" && order.handedOverAt
                      ? dayLabel(order.handedOverAt)
                      : etaValue
                        ? dayLabel(etaValue)
                        : "—"}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2 text-[13px]">
                  <span className="text-muted">Төлсөн</span>
                  <span className="tnum">{money(order.paidAmount)}</span>
                </div>
                {order.dueAmount > 0 && (
                  <div className="flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="text-muted">Шилжүүлэх</span>
                    <span className="tnum text-warn">{money(order.dueAmount)}</span>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-3 empty:pt-0">
                  {order.status !== "CANCELLED" && awaitingPayment(order.paymentState) && (
                    <Badge tone={PAYMENT_TONE[order.paymentState]}>
                      {PAYMENT_LABEL[order.paymentState]}
                    </Badge>
                  )}
                  {order.canChooseFulfilment && <Badge tone="ok">Авах аргаа сонгоно уу</Badge>}
                </div>
              </Card>
            </Link>
          );
        })}
      </div>

      <p className="mt-4 mb-0 text-center text-[13px] text-muted">
        Захиалга дээр дарж дэлгэрэнгүй явцыг харна уу.
      </p>
    </div>
  );
}

function PaymentsTab({
  orders,
  totalSpent,
  store,
}: {
  orders: MyOrder[];
  totalSpent: number;
  store: Store | null;
}) {
  // Буцаалт хийгдсэн захиалга ч мөнгөн хөдөлгөөнтэй тул энд харагдана.
  const paid = orders.filter(
    (o) => o.status !== "CANCELLED" && (o.paidAmount > 0 || o.refundedAmount > 0),
  );

  return (
    <div className="px-4 pt-4 lg:px-0 lg:pt-0">
      <div className="mb-3 hidden text-[20px] font-medium lg:block">Төлбөр</div>

      <Card surface className="mb-3 flex items-baseline justify-between gap-2 p-4 lg:hidden">
        <span className="text-[14px] text-ink-2">Нийт төлсөн</span>
        <span className="tnum text-[20px] font-medium">{money(totalSpent)}</span>
      </Card>

      {/* Laptop — дизайны хүснэгт: захиалга / огноо / дүн / төлөв */}
      {paid.length > 0 && (
        <div className="hidden overflow-hidden rounded-[12px] border border-line lg:block">
          <div className="grid grid-cols-[140px_minmax(0,1fr)_150px_150px] gap-x-4 border-b border-line bg-surface px-5 py-3 text-[13px] text-ink-2">
            <span>Захиалга</span>
            <span>Огноо</span>
            <span>Дүн</span>
            <span>Төлөв</span>
          </div>
          {paid.map((order) => (
            <div
              key={order.code}
              className="grid grid-cols-[140px_minmax(0,1fr)_150px_150px] items-center gap-x-4 border-b border-line px-5 py-3.5 last:border-b-0"
            >
              <span className="tnum text-[14px]">{order.code}</span>
              <span className="tnum text-[14px] text-ink-2">{dayLabel(order.createdAt)}</span>
              <span className="tnum text-[15px]">
                {money(order.paidAmount)}
                {order.refundedAmount > 0 && (
                  <span className="block text-[13px] text-muted">
                    − {money(order.refundedAmount)}
                  </span>
                )}
              </span>
              <span>
                <Badge tone={PAYMENT_TONE[order.paymentState]}>
                  {PAYMENT_LABEL[order.paymentState]}
                </Badge>
              </span>
            </div>
          ))}
        </div>
      )}

      {paid.length === 0 ? (
        <Empty>Төлбөрийн бичилт алга.</Empty>
      ) : (
        <Card className="divide-y divide-line lg:hidden">
          {paid.map((order) => (
            <div key={order.code} className="flex flex-col gap-1.5 p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="tnum text-[14px]">{order.code}</div>
                  <div className="text-[13px] text-muted">{dayLabel(order.createdAt)}</div>
                </div>
                <Badge tone={PAYMENT_TONE[order.paymentState]}>
                  {PAYMENT_LABEL[order.paymentState]}
                </Badge>
              </div>
              <div className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="text-muted">Төлсөн дүн</span>
                <span className="tnum">{money(order.paidAmount)}</span>
              </div>
              {order.refundedAmount > 0 && (
                <div className="flex items-baseline justify-between gap-2 text-[13px]">
                  <span className="text-muted">Буцаасан</span>
                  <span className="tnum">− {money(order.refundedAmount)}</span>
                </div>
              )}
              {order.dueAmount > 0 && (
                <div className="flex items-baseline justify-between gap-2 text-[13px]">
                  <span className="text-muted">Үлдэгдэл</span>
                  <span className="tnum text-warn">{money(order.dueAmount)}</span>
                </div>
              )}
            </div>
          ))}
        </Card>
      )}

      {store && (
        <p className="mt-3 mb-0 text-[13px] text-muted">
          Баримт хэрэгтэй бол <span className="tnum">{store.phone}</span> дугаарт хандана уу.
        </p>
      )}
    </div>
  );
}

function InfoTab() {
  const session = useSession();
  const me = session.me!;
  const [name, setName] = useState(me.name ?? "");
  const [district, setDistrict] = useState(me.address.district ?? "");
  const [khoroo, setKhoroo] = useState(me.address.khoroo ?? "");
  const [addressText, setAddressText] = useState(me.address.addressText ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.updateMe({
        name: name.trim() || null,
        district: district.trim() || null,
        khoroo: khoroo.trim() || null,
        addressText: addressText.trim() || null,
      });
      await session.refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Хадгалж чадсангүй.");
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (key: "notifyPayment" | "notifyArrival" | "notifyPromo", value: boolean) => {
    try {
      await api.updateMe({ [key]: value });
      await session.refresh();
    } catch {
      setError("Тохиргоог хадгалж чадсангүй.");
    }
  };

  return (
    <div className="flex flex-col gap-4 px-4 pt-4 lg:max-w-[720px] lg:gap-5 lg:px-0 lg:pt-0">
      <div className="hidden text-[20px] font-medium lg:block">Мэдээлэл</div>

      <Card className="flex flex-col gap-3 p-4 lg:gap-4 lg:p-6">
        <div className="text-[15px] font-medium">Хувийн мэдээлэл</div>
        {/* Laptop дээр нэр, утас зэрэгцээ — дизайны 2 багана */}
        <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-4">
          <Field label="Нэр">
            <Input value={name} onChange={setName} placeholder="Овог, нэр" />
          </Field>
          <Field label="Утас">
            <div className="flex h-11 items-center justify-between rounded-[8px] border border-line bg-surface px-3">
              <span className="tnum text-[15px]">{phoneLabel(me.phone)}</span>
              <span className="text-[13px] text-ok">Баталгаажсан</span>
            </div>
          </Field>
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-4 lg:gap-4 lg:p-6">
        <div>
          <div className="text-[15px] font-medium">Хадгалсан хаяг</div>
          <p className="mt-0.5 mb-0 text-[13px] text-muted">
            Хүргэлт сонгоход автоматаар орно
          </p>
        </div>
        {/*
          Дизайнд «Дүүрэг, хороо» нэг талбар боловч хүргэлтийн хураамж дүүргээр
          бодогддог тул тусад нь үлдээж, зэрэгцүүлж байрлууллаа.
        */}
        <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-4">
          <Field label="Дүүрэг">
            <Input value={district} onChange={setDistrict} placeholder="Дүүрэг" />
          </Field>
          <Field label="Хороо">
            <Input value={khoroo} onChange={setKhoroo} placeholder="Хороо" />
          </Field>
        </div>
        <Field label="Дэлгэрэнгүй">
          <Textarea
            value={addressText}
            onChange={setAddressText}
            placeholder="Байр, орц, тоот"
            rows={2}
          />
        </Field>
      </Card>

      <Card className="flex flex-col gap-1 p-4 lg:gap-2 lg:p-6">
        <div className="mb-1 text-[15px] font-medium">Мэдэгдэл</div>
        <Toggle
          label="Төлбөр баталгаажсан"
          hint="SMS-ээр мэдэгдэнэ"
          checked={me.notifications.payment}
          onChange={(v) => toggle("notifyPayment", v)}
        />
        <Divider />
        <Toggle
          label="Бараа ирсэн"
          hint="SMS-ээр мэдэгдэнэ"
          checked={me.notifications.arrival}
          onChange={(v) => toggle("notifyArrival", v)}
        />
        <Divider />
        <Toggle
          label="Шинэ бараа, урамшуулал"
          hint="Сард 1-2 удаа"
          checked={me.notifications.promo}
          onChange={(v) => toggle("notifyPromo", v)}
        />
      </Card>

      {error && <ErrorNote>{error}</ErrorNote>}

      <Button full onClick={save} loading={saving}>
        {saved ? "Хадгалсан" : "Хадгалах"}
      </Button>
    </div>
  );
}
