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
  Skeleton,
  Spinner,
  Textarea,
  Toggle,
  type Tone,
} from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";
import { BankAccountFields } from "@/components/BankAccountFields";
import { EmailAuthForm } from "@/components/EmailAuthForm";
import { LocationFields } from "@/components/LocationFields";
import { dayLabel, money, phoneLabel, refundPayoutLabel } from "@/lib/format";
import { UB_DISTRICTS } from "@/lib/locations";
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
      <div className='flex justify-center py-24'>
        <Spinner className='text-muted' />
      </div>
    );
  }

  return (
    <div className='screen pb-12'>
      <div className='px-4 pt-6 lg:hidden'>
        <div className='text-[20px] font-medium'>Миний профайл</div>
      </div>
      {session.me ? <Profile /> : <SignIn />}
    </div>
  );
}

/** И-мэйл + нууц үгээр нэвтрэх / бүртгүүлэх. */
function SignIn() {
  return (
    <div className='px-4 pt-6 lg:mx-auto lg:max-w-[420px] lg:px-0 lg:pt-10'>
      <Card className='flex flex-col gap-3 p-4 lg:p-6'>
        {/* <div>
          <div className='text-[15px] font-medium'>Нэвтрэх</div>
          
        </div> */}
        <EmailAuthForm />
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
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [result, s] = await Promise.all([api.myOrders(), api.store()]);
      setOrders(result.data);
      setTotals({
        totalSpent: result.meta.totalSpent,
        activeCount: result.meta.activeCount,
      });
      setStore(s);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Захиалга ачаалж чадсангүй.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const initial = (me.name ?? me.email).trim().charAt(0).toUpperCase();

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
          <div className='flex flex-col gap-3 px-4 pt-4 lg:grid lg:grid-cols-2 lg:gap-4 lg:px-0 lg:pt-0'>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className='h-44 w-full rounded-[12px]' />
            ))}
          </div>
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

function OrdersTab({
  orders,
  activeCount,
}: {
  orders: MyOrder[];
  activeCount: number;
}) {
  if (orders.length === 0) {
    return <Empty>Захиалга алга байна.</Empty>;
  }

  return (
    <div className='px-4 pt-4 lg:px-0 lg:pt-0'>
      <div className='mb-3 flex items-baseline justify-between gap-4 text-[13px] text-ink-2'>
        <span className='hidden text-[20px] font-medium text-ink lg:block'>
          Захиалга
        </span>
        <span>
          {activeCount > 0
            ? `${activeCount} захиалга явагдаж байна`
            : "Идэвхтэй захиалга алга"}
        </span>
      </div>

      <div className='flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-4'>
        {orders.map((order) => {
          const eta = order.timeline.find((s) => s.key === "arrived");
          const etaValue = eta?.at ?? eta?.estimatedAt;
          return (
            <Link
              key={order.code}
              href={`/t/${order.code}`}
              className='no-underline'
            >
              <Card className='h-full p-4 lg:p-5'>
                <div className='flex items-start justify-between gap-2'>
                  <div>
                    <div className='tnum text-[15px] font-medium lg:text-[18px] lg:font-normal'>
                      {order.code}
                    </div>
                    <div className='text-[13px] text-muted'>
                      {dayLabel(order.createdAt)} · {order.itemCount} бараа
                    </div>
                  </div>
                  <Badge tone={STATUS_TONE[order.status]}>
                    {order.statusLabel}
                  </Badge>
                </div>

                <div className='mt-3 flex gap-1'>
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

                <Divider className='my-3' />

                <div className='flex items-baseline justify-between gap-2 text-[13px]'>
                  <span className='text-muted'>
                    {order.status === "HANDED_OVER"
                      ? "Хүлээлгэн өгсөн"
                      : "Гарт очих"}
                  </span>
                  <span className='tnum'>
                    {order.status === "HANDED_OVER" && order.handedOverAt
                      ? dayLabel(order.handedOverAt)
                      : etaValue
                        ? dayLabel(etaValue)
                        : "—"}
                  </span>
                </div>
                <div className='flex items-baseline justify-between gap-2 text-[13px]'>
                  <span className='text-muted'>Төлсөн</span>
                  <span className='tnum'>{money(order.paidAmount)}</span>
                </div>
                {order.dueAmount > 0 && (
                  <div className='flex items-baseline justify-between gap-2 text-[13px]'>
                    <span className='text-muted'>Шилжүүлэх</span>
                    <span className='tnum text-warn'>
                      {money(order.dueAmount)}
                    </span>
                  </div>
                )}
                {order.refundPayoutOn && (
                  <div className='flex items-baseline justify-between gap-2 text-[13px]'>
                    <span className='text-muted'>Буцаалт</span>
                    <span className={`text-right ${order.refundPaid ? "text-ok" : ""}`}>
                      {refundPayoutLabel(order.refundPayoutOn, order.refundPaid)}
                    </span>
                  </div>
                )}

                <div className='flex flex-wrap gap-2 pt-3 empty:pt-0'>
                  {order.status !== "CANCELLED" &&
                    awaitingPayment(order.paymentState) && (
                      <Badge tone={PAYMENT_TONE[order.paymentState]}>
                        {PAYMENT_LABEL[order.paymentState]}
                      </Badge>
                    )}
                  {order.canChooseFulfilment && (
                    <Badge tone='ok'>Авах аргаа сонгоно уу</Badge>
                  )}
                </div>
              </Card>
            </Link>
          );
        })}
      </div>

      <p className='mt-4 mb-0 text-center text-[13px] text-muted'>
        Захиалга дээр дарж дэлгэрэнгүй явцыг харна уу.
      </p>
    </div>
  );
}

function PaymentsTab() {
  const session = useSession();
  const toast = useToast();
  const me = session.me!;
  const [bankName, setBankName] = useState(me.bank?.name ?? "");
  const [bankAccountNumber, setBankAccountNumber] = useState(
    me.bank?.accountNumber ?? "",
  );
  const [bankAccountName, setBankAccountName] = useState(
    me.bank?.accountName ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setBankName(me.bank?.name ?? "");
    setBankAccountNumber(me.bank?.accountNumber ?? "");
    setBankAccountName(me.bank?.accountName ?? "");
  }, [me.bank]);

  const complete =
    bankName.trim().length > 0 &&
    bankAccountNumber.trim().length >= 6 &&
    bankAccountName.trim().length > 0;

  const saveBank = async () => {
    if (!complete) {
      toast.error("Банк, дансны дугаар, дансны нэрийг бөглөнө үү.");
      return;
    }
    setSaving(true);
    try {
      await api.updateMe({
        bankName: bankName.trim(),
        bankAccountNumber: bankAccountNumber.trim(),
        bankAccountName: bankAccountName.trim(),
        defaultPayoutBank: true,
      });
      await session.refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      toast.success("Данс хадгалагдлаа.");
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Данс хадгалах боломжгүй байна.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='px-4 pt-4 lg:px-0 lg:pt-0'>
      <div className='mb-3 hidden text-[20px] font-medium lg:block'>Данс</div>

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
    </div>
  );
}

function InfoTab({ store }: { store: Store | null }) {
  const session = useSession();
  const toast = useToast();
  const me = session.me!;
  const [name, setName] = useState(me.name ?? "");
  const [phone, setPhone] = useState(me.phone ?? "");
  const [district, setDistrict] = useState(me.address.district ?? "");
  const [khoroo, setKhoroo] = useState(me.address.khoroo ?? "");
  const [addressText, setAddressText] = useState(me.address.addressText ?? "");
  const [notif, setNotif] = useState(me.notifications);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailStep, setEmailStep] = useState<"form" | "code">("form");
  const [credBusy, setCredBusy] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.updateMe({
        name: name.trim() || null,
        phone: phone.trim() || null,
        district: district.trim() || null,
        khoroo: khoroo.trim() || null,
        addressText: addressText.trim() || null,
      });
      await session.refresh();
      setSaved(true);
      toast.success("Мэдээлэл хадгалагдлаа.");
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Хадгалж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    setCredBusy(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      toast.success("Нууц үг солигдлоо.");
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Нууц үг солиж чадсангүй.",
      );
    } finally {
      setCredBusy(false);
    }
  };

  const requestEmailChange = async () => {
    setCredBusy(true);
    try {
      await api.changeEmail(newEmail.trim(), emailPassword);
      setEmailStep("code");
      toast.success("Баталгаажуулах код илгээлээ.");
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "И-мэйл солиж чадсангүй.",
      );
    } finally {
      setCredBusy(false);
    }
  };

  const confirmEmailChange = async () => {
    setCredBusy(true);
    try {
      const result = await api.verifyEmail(newEmail.trim(), emailCode);
      await session.signIn(result.token);
      setEmailStep("form");
      setNewEmail("");
      setEmailPassword("");
      setEmailCode("");
      toast.success("И-мэйл солигдлоо.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Код буруу байна.");
    } finally {
      setCredBusy(false);
    }
  };

  const toggle = async (
    key: "notifyPayment" | "notifyArrival" | "notifyPromo",
    field: "payment" | "arrival" | "promo",
    value: boolean,
  ) => {
    const prev = notif;
    setNotif({ ...notif, [field]: value });
    try {
      await api.updateMe({ [key]: value });
      void session.refresh();
      toast.success("Тохиргоо хадгалагдлаа.");
    } catch {
      setNotif(prev);
      toast.error("Тохиргоог хадгалж чадсангүй. Дахин оролдоно уу.");
    }
  };

  return (
    <div className='flex flex-col gap-4 px-4 pt-4 lg:max-w-[720px] lg:gap-5 lg:px-0 lg:pt-0'>
      <div className='hidden text-[20px] font-medium lg:block'>Мэдээлэл</div>

      <Card className='flex flex-col gap-3 p-4 lg:gap-4 lg:p-6'>
        <div className='text-[15px] font-medium'>Хувийн мэдээлэл</div>
        <div className='flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-4'>
          <Field label='Нэр'>
            <Input value={name} onChange={setName} placeholder='Овог, нэр' />
          </Field>
          <Field label='И-мэйл'>
            <div className='flex h-11 items-center justify-between rounded-[8px] border border-line bg-surface px-3'>
              <span className='truncate text-[15px]'>{me.email}</span>
              <span
                className={`shrink-0 text-[13px] ${me.emailVerified ? "text-ok" : "text-warn"}`}
              >
                {me.emailVerified ? "Баталгаажсан" : "Хүлээгдэж буй"}
              </span>
            </div>
          </Field>
          <Field label='Утас' hint='Холбоо барих'>
            <Input
              value={phone}
              onChange={(v) => setPhone(v.replace(/\D/g, "").slice(0, 8))}
              inputMode='numeric'
              placeholder='99119911'
            />
          </Field>
        </div>
      </Card>

      <Card className='flex flex-col gap-3 p-4 lg:gap-4 lg:p-6'>
        <div className='text-[15px] font-medium'>Буцаалтын данс</div>
        {me.bank?.accountNumber ? (
          <div className='flex flex-col gap-1.5 text-[14px]'>
            <div>{me.bank.name || "Банк сонгоогүй"}</div>
            <div className='tnum'>{me.bank.accountNumber}</div>
            <div className='text-ink-2'>{me.bank.accountName || "Дансны нэр алга"}</div>
            <p className='mb-0 mt-1 text-[13px] text-muted'>
              Засах бол «Данс» хэсэгт орно уу.
            </p>
          </div>
        ) : (
          <p className='m-0 text-[13px] text-muted'>
            Данс хадгалаагүй байна. «Данс» хэсэгт банк, дугаар, нэрээ оруулна уу. Буцаалт энэ
            данс руу орно.
          </p>
        )}
      </Card>

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
          loading={credBusy}
          disabled={currentPassword.length < 1 || newPassword.length < 6}
        >
          Нууц үг хадгалах
        </Button>
      </Card>

      <Card className='flex flex-col gap-3 p-4 lg:gap-4 lg:p-6'>
        <div className='text-[15px] font-medium'>И-мэйл солих</div>
        {emailStep === "form" ? (
          <>
            <div className='flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-4'>
              <Field label='Шинэ и-мэйл'>
                <Input value={newEmail} onChange={setNewEmail} type='email' />
              </Field>
              <Field label='Одоогийн нууц үг'>
                <Input
                  value={emailPassword}
                  onChange={setEmailPassword}
                  type='password'
                />
              </Field>
            </div>
            <Button
              onClick={requestEmailChange}
              loading={credBusy}
              disabled={!newEmail.trim() || emailPassword.length < 1}
            >
              Код илгээх
            </Button>
          </>
        ) : (
          <>
            <Field label='Баталгаажуулах код'>
              <Input
                value={emailCode}
                onChange={(v) => setEmailCode(v.replace(/\D/g, "").slice(0, 6))}
                inputMode='numeric'
                maxLength={6}
              />
            </Field>
            <div className='flex gap-2'>
              <Button
                onClick={confirmEmailChange}
                loading={credBusy}
                disabled={emailCode.length !== 6}
              >
                Баталгаажуулах
              </Button>
              <Button
                variant='ghost'
                onClick={() => setEmailStep("form")}
                disabled={credBusy}
              >
                Болих
              </Button>
            </div>
          </>
        )}
      </Card>

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
          onDistrictChange={(v) => setDistrict(v ?? "")}
          khoroo={khoroo}
          onKhorooChange={setKhoroo}
        />
        <Field label='Дэлгэрэнгүй'>
          <Textarea
            value={addressText}
            onChange={setAddressText}
            placeholder='Байр, орц, тоот'
            rows={2}
          />
        </Field>
      </Card>

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

      {error && <ErrorNote>{error}</ErrorNote>}

      <Button full onClick={save} loading={saving}>
        {saved ? "Хадгалсан ✓" : "Хадгалах"}
      </Button>
    </div>
  );
}
