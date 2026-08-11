"use client";

import { useCallback, useEffect, useState } from "react";
import { OrderDetail } from "@/components/admin/OrderDetail";
import {
  Metric,
  OrderBadge,
  PageHead,
  Table,
  Td,
  Th,
} from "@/components/admin/shared";
import {
  Button,
  Card,
  Empty,
  ErrorNote,
  Field,
  Input,
  Skeleton,
  Toggle,
} from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { dayLabel, money, phoneLabel } from "@/lib/format";
import { useToast } from "@/lib/toast";
import type { AdminCustomer, OrderItem } from "@/lib/types";

type CustomerOrder = {
  id: string;
  code: string;
  status: import("@/lib/types").OrderStatus;
  statusLabel: string;
  subtotal: number;
  dueAmount: number;
  fulfilment: string | null;
  items: OrderItem[];
  createdAt: string;
};

type CustomerDetail = AdminCustomer & {
  stats: {
    orderCount: number;
    totalSpent: number;
    handedOver: number;
    cancelled: number;
    lastOrderAt: string | null;
  };
  orders: CustomerOrder[];
};

export default function CustomersPage() {
  const toast = useToast();
  const [rows, setRows] = useState<AdminCustomer[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      const list = await adminApi.customers({ q: query || undefined, pageSize: 100 });
      setRows(list.data);
      setTotal(list.meta?.total ?? list.data.length);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Ачаалж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [query, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    try {
      const id = sessionStorage.getItem("itgel.admin.openCustomer");
      if (id) {
        sessionStorage.removeItem("itgel.admin.openCustomer");
        setOpenId(id);
      }
    } catch {
      /* ignore */
    }
  }, []);

  if (openOrderId) {
    return (
      <OrderDetail
        orderId={openOrderId}
        onClose={() => setOpenOrderId(null)}
        onChanged={() => void load()}
      />
    );
  }

  if (openId) {
    return (
      <CustomerDetailView
        customerId={openId}
        onBack={() => {
          setOpenId(null);
          void load();
        }}
        onOpenOrder={setOpenOrderId}
      />
    );
  }

  const spent = rows.reduce((sum, r) => sum + r.totalSpent, 0);
  const repeat = rows.filter((r) => r.orderCount > 1).length;

  return (
    <div>
      <PageHead
        title="Хэрэглэгчид"
        hint="И-мэйлээр нэвтэрнэ. Утас — холбоо барих мэдээлэл."
        actions={
          <Button onClick={() => setCreating((v) => !v)}>
            {creating ? "Болих" : "Хэрэглэгч нэмэх"}
          </Button>
        }
      />

      {creating && (
        <CreateCustomerForm
          onCreated={(id) => {
            setCreating(false);
            void load();
            setOpenId(id);
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Нийт хэрэглэгч" value={total} />
        <Metric label="Давтан захиалагч" value={repeat} tone="ok" />
        <Metric label="Нийт зарцуулалт" value={money(spent)} sub="Энэ хуудсанд" />
        <Metric
          label="Дундаж"
          value={money(rows.length ? Math.round(spent / rows.length) : 0)}
        />
      </div>

      <div className="mb-4 flex max-w-[420px] items-center gap-2">
        <div className="flex-1">
          <Input value={search} onChange={setSearch} placeholder="И-мэйл, нэр эсвэл утас" />
        </div>
        {refreshing && <span className="text-[13px] text-muted">Шинэчилж байна…</span>}
      </div>

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-[12px]" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Empty>Хэрэглэгч олдсонгүй.</Empty>
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>Нэр</Th>
                  <Th>И-мэйл</Th>
                  <Th>Утас</Th>
                  <Th>Захиалга</Th>
                  <Th>Нийт зарцуулалт</Th>
                  <Th>Сүүлд</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => setOpenId(row.id)}
                    className="cursor-pointer transition-colors hover:bg-surface"
                  >
                    <Td>
                      <span className="underline underline-offset-2">{row.name ?? "—"}</span>
                      {!row.emailVerified && (
                        <div className="text-[12px] text-warn">Баталгаажаагүй</div>
                      )}
                    </Td>
                    <Td className="text-[13px]">{row.email}</Td>
                    <Td className="tnum">{phoneLabel(row.phone)}</Td>
                    <Td className="tnum">{row.orderCount}</Td>
                    <Td className="tnum">{money(row.totalSpent)}</Td>
                    <Td className="tnum text-[13px] text-ink-2">
                      {row.lastOrderAt ? dayLabel(row.lastOrderAt) : "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>

          <div className="flex flex-col gap-3 md:hidden">
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => setOpenId(row.id)}
                className="cursor-pointer rounded-[12px] border border-line bg-bg p-4 text-left"
              >
                <div className="text-[15px]">{row.name ?? "Нэргүй"}</div>
                <div className="truncate text-[13px] text-muted">{row.email}</div>
                <div className="tnum text-[13px] text-muted">{phoneLabel(row.phone)}</div>
                <div className="mt-2 flex items-baseline justify-between text-[13px]">
                  <span className="text-muted">{row.orderCount} захиалга</span>
                  <span className="tnum">{money(row.totalSpent)}</span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CreateCustomerForm({
  onCreated,
  onCancel,
}: {
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const created = await adminApi.createCustomer({
        email: email.trim(),
        name: name.trim() || null,
        phone: phone.trim() || null,
        password: password || undefined,
        emailVerified: true,
      });
      toast.success("Хэрэглэгч үүслээ.");
      onCreated(created.id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Үүсгэж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-4 flex flex-col gap-3 p-4">
      <div className="text-[15px] font-medium">Шинэ хэрэглэгч</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="И-мэйл">
          <Input value={email} onChange={setEmail} type="email" placeholder="user@gmail.com" />
        </Field>
        <Field label="Нэр">
          <Input value={name} onChange={setName} placeholder="Нэр" />
        </Field>
        <Field label="Утас" hint="Заавал биш">
          <Input value={phone} onChange={setPhone} inputMode="tel" placeholder="99112233" />
        </Field>
        <Field label="Нууц үг" hint="Хоосон бол нэвтрэх боломжгүй — дараа тохируулна">
          <Input value={password} onChange={setPassword} type="password" placeholder="••••••" />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button onClick={save} loading={busy} disabled={!email.trim()}>
          Үүсгэх
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Болих
        </Button>
      </div>
    </Card>
  );
}

function CustomerDetailView({
  customerId,
  onBack,
  onOpenOrder,
}: {
  customerId: string;
  onBack: () => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const toast = useToast();
  const [data, setData] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [emailVerified, setEmailVerified] = useState(true);
  const [district, setDistrict] = useState("");
  const [khoroo, setKhoroo] = useState("");
  const [addressText, setAddressText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const detail = await adminApi.customer(customerId);
      setData(detail as CustomerDetail);
      setEmail(detail.email);
      setName(detail.name ?? "");
      setPhone(detail.phone ?? "");
      setEmailVerified(detail.emailVerified);
      setDistrict(detail.address?.district ?? "");
      setKhoroo(detail.address?.khoroo ?? "");
      setAddressText(detail.address?.addressText ?? "");
      setPassword("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    try {
      await adminApi.updateCustomer(customerId, {
        email: email.trim(),
        name: name.trim() || null,
        phone: phone.trim() || null,
        emailVerified,
        district: district.trim() || null,
        khoroo: khoroo.trim() || null,
        addressText: addressText.trim() || null,
        ...(password.trim() ? { password: password.trim() } : {}),
      });
      toast.success("Хэрэглэгч хадгалагдлаа.");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Хадгалж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div>
        <Skeleton className="mb-4 h-9 w-40" />
        <Skeleton className="mb-3 h-24" />
        <Skeleton className="h-[240px]" />
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <Button variant="outline" size="sm" onClick={onBack}>
          ← Буцах
        </Button>
        <div className="mt-4">
          <ErrorNote>{error ?? "Хэрэглэгч олдсонгүй."}</ErrorNote>
        </div>
      </div>
    );
  }

  const debt = data.orders
    .filter((o) => o.status !== "CANCELLED")
    .reduce((sum, o) => sum + Math.max(0, o.dueAmount), 0);

  return (
    <div>
      <div className="mb-4">
        <Button variant="outline" size="sm" onClick={onBack}>
          ← Хэрэглэгчид
        </Button>
      </div>

      <PageHead
        title={data.name ?? data.email}
        hint={`${data.email} · бүртгэгдсэн ${dayLabel(data.createdAt)}`}
        actions={
          <Button onClick={save} loading={busy}>
            Хадгалах
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Захиалга" value={data.stats.orderCount} />
        <Metric label="Нийт зарцуулалт" value={money(data.stats.totalSpent)} />
        <Metric label="Хүлээлгэн өгсөн" value={data.stats.handedOver} tone="ok" />
        <Metric label="Дутуу төлбөр" value={money(debt)} tone={debt > 0 ? "warn" : "ok"} />
      </div>

      <Card className="mb-5 flex flex-col gap-3 p-4">
        <div className="text-[15px] font-medium">Мэдээлэл засах</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="И-мэйл">
            <Input value={email} onChange={setEmail} type="email" />
          </Field>
          <Field label="Нэр">
            <Input value={name} onChange={setName} />
          </Field>
          <Field label="Утас">
            <Input value={phone} onChange={setPhone} inputMode="tel" />
          </Field>
          <Field label="Шинэ нууц үг" hint="Хоосон бол хэвээр">
            <Input value={password} onChange={setPassword} type="password" placeholder="••••••" />
          </Field>
          <Field label="Дүүрэг">
            <Input value={district} onChange={setDistrict} />
          </Field>
          <Field label="Хороо">
            <Input value={khoroo} onChange={setKhoroo} />
          </Field>
          <Field label="Хаяг" hint="Дэлгэрэнгүй">
            <Input value={addressText} onChange={setAddressText} />
          </Field>
          <div className="flex items-center justify-between rounded-[8px] border border-line px-3 py-2 sm:col-span-2">
            <Toggle
              label="И-мэйл баталгаажсан"
              checked={emailVerified}
              onChange={setEmailVerified}
            />
          </div>
        </div>
      </Card>

      <h2 className="mb-2 text-[16px] font-medium">Захиалгын түүх</h2>
      {data.orders.length === 0 ? (
        <Empty>Захиалга алга.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Код</Th>
              <Th>Огноо</Th>
              <Th className="text-right">Дүн</Th>
              <Th>Төлөв</Th>
            </tr>
          </thead>
          <tbody>
            {data.orders.map((order) => {
              const itemCount = order.items
                .filter((i) => !i.cancelled)
                .reduce((sum, i) => sum + i.qty, 0);
              return (
                <tr
                  key={order.id}
                  onClick={() => onOpenOrder(order.id)}
                  className="cursor-pointer transition-colors hover:bg-surface"
                >
                  <Td>
                    <span className="tnum underline underline-offset-2">{order.code}</span>
                    <div className="text-[12px] text-muted">{itemCount} ш</div>
                  </Td>
                  <Td className="tnum text-[13px] text-ink-2">{dayLabel(order.createdAt)}</Td>
                  <Td className="text-right">
                    <span className="tnum">{money(order.subtotal)}</span>
                    {order.dueAmount > 0 && (
                      <div className="tnum text-[12px] text-warn">
                        дутуу {money(order.dueAmount)}
                      </div>
                    )}
                  </Td>
                  <Td>
                    <OrderBadge status={order.status} />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}
