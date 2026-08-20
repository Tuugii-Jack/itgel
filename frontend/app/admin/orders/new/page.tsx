"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { PageHead } from "@/components/admin/shared";
import { Button, Card, ErrorNote, Field, Input, Spinner } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { isFullAdmin } from "@/lib/admin-role";
import { useAdminSession } from "@/lib/admin-session";
import { money, phoneLabel } from "@/lib/format";
import { optionValuePrice, optionValueSoldOut, priceForSelections, priceLabel } from "@/lib/options";
import { useToast } from "@/lib/toast";
import type { AdminCustomer, AdminProduct, AdminRound, ProductOption } from "@/lib/types";

type LineDraft = {
  key: string;
  roundId: string;
  name: string;
  price: number;
  qty: number;
  options: ProductOption[];
  selections: Record<string, string>;
};

type RoundRow = { product: AdminProduct; round: AdminRound };

export default function AdminCreateOrderPage() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAdminSession();
  const canWrite = isFullAdmin(user?.role);

  const [customerQ, setCustomerQ] = useState("");
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");

  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFilter, setPickerFilter] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [lines, setLines] = useState<LineDraft[]>([]);

  const [status, setStatus] = useState<"NEW" | "CONFIRMED">("CONFIRMED");
  const [markPaid, setMarkPaid] = useState(true);
  const [note, setNote] = useState("");

  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canWrite) {
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        const list = await adminApi.products({ pageSize: 100 });
        setProducts(list.data);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Бараа ачаалж чадсангүй.");
      } finally {
        setLoading(false);
      }
    })();
  }, [canWrite]);

  useEffect(() => {
    const q = customerQ.trim();
    if (q.length < 2) {
      setCustomers([]);
      return;
    }
    const timer = setTimeout(() => {
      void adminApi
        .customers({ q, pageSize: 8 })
        .then((res) => setCustomers(res.data))
        .catch(() => setCustomers([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [customerQ]);

  const pickCustomer = (c: AdminCustomer) => {
    setCustomerId(c.id);
    setEmail(c.email);
    setPhone(c.phone ?? "");
    setName(c.name ?? "");
    setCustomerQ("");
    setCustomers([]);
  };

  const clearCustomer = () => {
    setCustomerId(null);
    setEmail("");
    setPhone("");
    setName("");
  };

  const allRounds = useMemo(() => {
    const out: RoundRow[] = [];
    for (const p of products) {
      for (const r of p.rounds ?? []) {
        if (r.deletedAt) continue;
        if (r.status !== "ACTIVE" && r.status !== "CLOSED") continue;
        out.push({ product: p, round: r });
      }
    }
    return out;
  }, [products]);

  const filteredRounds = useMemo(() => {
    const q = pickerFilter.trim().toLowerCase();
    if (!q) return allRounds;
    return allRounds.filter(
      ({ product, round }) =>
        product.name.toLowerCase().includes(q) || String(round.roundNo).includes(q),
    );
  }, [allRounds, pickerFilter]);

  const openPicker = () => {
    setPicked(new Set(lines.map((l) => l.roundId)));
    setPickerFilter("");
    setPickerOpen(true);
  };

  const togglePick = (roundId: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(roundId)) next.delete(roundId);
      else next.add(roundId);
      return next;
    });
  };

  const confirmPicks = () => {
    const byRound = new Map(allRounds.map((r) => [r.round.id, r]));
    setLines((prev) => {
      const keep = prev.filter((l) => picked.has(l.roundId));
      const have = new Set(keep.map((l) => l.roundId));
      const added: LineDraft[] = [];
      for (const id of picked) {
        if (have.has(id)) continue;
        const row = byRound.get(id);
        if (!row) continue;
        const selections: Record<string, string> = {};
        for (const opt of row.product.options) {
          if (opt.values[0]) selections[opt.name] = opt.values[0];
        }
        added.push({
          key: `${row.round.id}-${Date.now()}-${added.length}`,
          roundId: row.round.id,
          name: `${row.product.name}${row.round.roundNo ? ` #${row.round.roundNo}` : ""}`,
          price: priceForSelections(
            row.round.sellPrice,
            row.round.optionPrices,
            selections,
          ),
          qty: 1,
          options: row.product.options,
          selections,
        });
      }
      return [...keep, ...added];
    });
    setPickerOpen(false);
  };

  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);

  const submit = async () => {
    if (lines.length === 0) {
      setError("Бараа сонгоно уу.");
      return;
    }
    if (!customerId && !email.trim()) {
      setError("И-мэйл эсвэл бүртгэлтэй хэрэглэгч сонгоно уу.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const order = await adminApi.createOrder({
        customerId: customerId ?? undefined,
        email: customerId ? undefined : email.trim(),
        phone: phone.trim() || undefined,
        name: name.trim() || undefined,
        note: note.trim() || undefined,
        status,
        markPaid: status === "CONFIRMED" ? markPaid : false,
        items: lines.map((l) => ({
          productId: l.roundId,
          qty: l.qty,
          selections: l.selections,
        })),
      });
      toast.success(`${order.code} үүслээ.`);
      router.push("/admin");
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Үүсгэж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="text-muted" />
      </div>
    );
  }

  if (!canWrite) {
    return (
      <div className="mx-auto max-w-[640px]">
        <PageHead
          title="Захиалга оруулах"
          hint="Туслах админ захиалга үүсгэх эрхгүй."
          actions={
            <Link href="/admin" className="text-[13px] text-ink-2 underline">
              Буцах
            </Link>
          }
        />
        <p className="m-0 text-[14px] text-ink-2">
          Та захиалга харах, бараа ирсний дараа хүлээлгэн өгөх боломжтой.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[640px]">
      <PageHead
        title="Захиалга оруулах"
        hint="Утсаар / дэлгүүрт авсан захиалгыг гараар бүртгэнэ."
        actions={
          <Link href="/admin" className="text-[13px] text-ink-2 underline">
            Буцах
          </Link>
        }
      />

      <Card className="mb-4 flex flex-col gap-3 p-4">
        <div className="text-[15px] font-medium">Хэрэглэгч</div>
        {customerId ? (
          <div className="flex items-start justify-between gap-3 rounded-[8px] border border-line bg-surface p-3">
            <div>
              <div className="text-[15px]">{name || "Нэргүй"}</div>
              <div className="text-[13px] text-ink-2">
                {email}
                {phone ? ` · ${phoneLabel(phone)}` : ""}
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={clearCustomer}>
              Солих
            </Button>
          </div>
        ) : (
          <>
            <Field label="Хайх" hint="Утас, нэр эсвэл и-мэйл">
              <Input value={customerQ} onChange={setCustomerQ} placeholder="9911… / бат@…" />
            </Field>
            {customers.length > 0 && (
              <div className="divide-y divide-line rounded-[8px] border border-line">
                {customers.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => pickCustomer(c)}
                    className="flex w-full cursor-pointer flex-col items-start gap-0.5 border-0 bg-transparent px-3 py-2.5 text-left hover:bg-surface"
                  >
                    <span className="text-[14px]">{c.name ?? "Нэргүй"}</span>
                    <span className="text-[12px] text-muted">
                      {c.email}
                      {c.phone ? ` · ${phoneLabel(c.phone)}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="И-мэйл">
                <Input value={email} onChange={setEmail} type="email" placeholder="you@gmail.com" />
              </Field>
              <Field label="Утас">
                <Input
                  value={phone}
                  onChange={(v) => setPhone(v.replace(/\D/g, "").slice(0, 8))}
                  placeholder="99112233"
                />
              </Field>
            </div>
            <Field label="Нэр" hint="Заавал биш">
              <Input value={name} onChange={setName} placeholder="Овог, нэр" />
            </Field>
          </>
        )}
      </Card>

      <Card className="mb-4 flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[15px] font-medium">Бараа</div>
          <Button size="sm" variant="outline" onClick={openPicker}>
            Бараа сонгох
          </Button>
        </div>

        {lines.length === 0 ? (
          <button
            type="button"
            onClick={openPicker}
            className="cursor-pointer rounded-[10px] border border-dashed border-line bg-surface px-4 py-8 text-center text-[14px] text-ink-2 hover:border-ink/30"
          >
            Бараа сонгох товчийг дарж нэмнэ
          </button>
        ) : (
          <div className="flex flex-col gap-3">
            {lines.map((line) => (
              <div key={line.key} className="rounded-[8px] border border-line p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium">{line.name}</div>
                    <div className="tnum text-[13px] text-muted">{money(line.price)}</div>
                  </div>
                  <button
                    type="button"
                    className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-danger"
                    onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                  >
                    Хасах
                  </button>
                </div>
                {line.options.map((opt) => {
                  const row = allRounds.find((r) => r.round.id === line.roundId);
                  const priced = (row?.round.optionPrices ?? []).length > 0;
                  return (
                  <label key={opt.name} className="mt-2 block text-[13px]">
                    <span className="text-ink-2">{opt.name}</span>
                    <select
                      className="mt-1 w-full rounded-[8px] border border-line bg-bg px-2 py-2"
                      value={line.selections[opt.name] ?? ""}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l) => {
                            if (l.key !== line.key) return l;
                            const selections = { ...l.selections, [opt.name]: e.target.value };
                            const found = allRounds.find((r) => r.round.id === l.roundId);
                            return {
                              ...l,
                              selections,
                              price: priceForSelections(
                                found?.round.sellPrice ?? l.price,
                                found?.round.optionPrices,
                                selections,
                              ),
                            };
                          }),
                        )
                      }
                    >
                      {opt.values.map((v) => {
                        const p = optionValuePrice(
                          row?.round.optionPrices,
                          opt.name,
                          v,
                          line.price,
                          line.selections,
                        );
                        const gone =
                          row?.round.type === "ready" &&
                          optionValueSoldOut(
                            row.round.skuStocks,
                            line.selections,
                            opt.name,
                            v,
                          );
                        return (
                          <option key={v} value={v} disabled={gone}>
                            {gone
                              ? `${v} — Дууссан`
                              : priced
                                ? `${v} · ${money(p)}`
                                : v}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  );
                })}
                <label className="mt-2 block text-[13px]">
                  <span className="text-ink-2">Тоо</span>
                  <Input
                    type="number"
                    className="mt-1"
                    value={String(line.qty)}
                    onChange={(v) =>
                      setLines((prev) =>
                        prev.map((l) =>
                          l.key === line.key
                            ? { ...l, qty: Math.max(1, Math.min(50, Number(v) || 1)) }
                            : l,
                        ),
                      )
                    }
                  />
                </label>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-between border-t border-line pt-3 text-[15px]">
          <span>Нийт</span>
          <span className="tnum font-medium">{money(subtotal)}</span>
        </div>
      </Card>

      <Card className="mb-4 flex flex-col gap-3 p-4">
        <div className="text-[15px] font-medium">Төлөв</div>
        <div className="flex gap-2">
          {(
            [
              ["CONFIRMED", "Баталгаажсан"],
              ["NEW", "Шинэ (төлбөр хүлээнэ)"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setStatus(id)}
              className={`h-10 flex-1 cursor-pointer rounded-[8px] border text-[13px] ${
                status === id ? "border-ink bg-ink text-white" : "border-line bg-bg"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {status === "CONFIRMED" && (
          <label className="flex cursor-pointer items-center gap-2 text-[14px]">
            <input
              type="checkbox"
              checked={markPaid}
              onChange={(e) => setMarkPaid(e.target.checked)}
              className="size-4"
            />
            Төлбөр бүрэн авсан (бэлэн)
          </label>
        )}
        <Field label="Тэмдэглэл" hint="Заавал биш">
          <Input value={note} onChange={setNote} placeholder="Ж: утсаар захиалсан" />
        </Field>
      </Card>

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <Button full className="h-12" loading={busy} onClick={() => void submit()}>
        Захиалга үүсгэх
      </Button>

      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Бараа сонгох"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-[520px] flex-col rounded-t-[16px] bg-bg sm:rounded-[16px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div className="text-[16px] font-medium">Бараа сонгох</div>
              <button
                type="button"
                className="cursor-pointer border-0 bg-transparent p-0 text-[14px] text-ink-2"
                onClick={() => setPickerOpen(false)}
              >
                Хаах
              </button>
            </div>
            <div className="border-b border-line px-4 py-3">
              <Input
                value={pickerFilter}
                onChange={setPickerFilter}
                placeholder="Жагсаалтаас шүүх…"
                autoFocus
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
              {filteredRounds.length === 0 ? (
                <div className="px-3 py-8 text-center text-[13px] text-muted">Бараа алга.</div>
              ) : (
                filteredRounds.map(({ product, round }) => {
                  const checked = picked.has(round.id);
                  return (
                    <label
                      key={round.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-[10px] px-3 py-3 ${
                        checked ? "bg-surface" : "hover:bg-surface/60"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 size-4 shrink-0"
                        checked={checked}
                        onChange={() => togglePick(round.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] leading-[1.35]">{product.name}</span>
                        <span className="text-[12px] text-muted">
                          #{round.roundNo} · {round.status}
                          {round.closeAt === null ? " · бэлэн" : ""}
                        </span>
                      </span>
                      <span className="tnum shrink-0 text-[14px]">
                        {priceLabel(round.price, round.priceMax)}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
            <div className="flex gap-2 border-t border-line p-4">
              <Button variant="outline" className="flex-1" onClick={() => setPickerOpen(false)}>
                Болих
              </Button>
              <Button className="flex-[1.4]" onClick={confirmPicks}>
                Нэмэх ({picked.size})
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
