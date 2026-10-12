"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Minus, Plus, Trash2 } from "lucide-react";
import { PageHead } from "@/components/admin/shared";
import { SearchField } from "@/components/admin/SearchField";
import { ProductImage } from "@/components/ProductImage";
import { Button, Card, Empty, ErrorNote, Field, Input, Skeleton } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { isFullAdmin } from "@/lib/admin-role";
import { useAdminSession } from "@/lib/admin-session";
import { money, phoneLabel } from "@/lib/format";
import { formatSelections, priceForSelections, selectedSkuStock } from "@/lib/options";
import { adminOrderPaymentChoice, parseWholeQuantity, validCustomerContact } from "@/lib/adminWorkflow";
import { useWorkspaceQuery } from "@/lib/useWorkspaceQuery";
import { workspaceHref } from "@/lib/workspaceNavigation";
import { useToast } from "@/lib/toast";
import type { AdminCustomer, AdminProduct, AdminRound } from "@/lib/types";

type RoundRow = { product: AdminProduct; round: AdminRound };
type Line = RoundRow & { key: string; qty: number; selections: Record<string, string> };
const STEPS = ["Хэрэглэгч", "Бараа", "Шалгаж үүсгэх"];
const priceOf = (line: Line) => priceForSelections(line.round.sellPrice, line.round.optionPrices, line.selections);

export default function CreateOrderPage() {
  const router = useRouter(); const toast = useToast(); const { user } = useAdminSession();
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<"search" | "new">("search");
  const [customerQ, setCustomerQ] = useState(""); const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [searching, setSearching] = useState(false); const [customerId, setCustomerId] = useState<string | null>(null);
  const [email, setEmail] = useState(""); const [phone, setPhone] = useState(""); const [name, setName] = useState("");
  const [linkedCustomer] = useWorkspaceQuery("customer");
  const [products, setProducts] = useState<AdminProduct[]>([]); const [productQ, setProductQ] = useState("");
  const [loading, setLoading] = useState(true); const [page, setPage] = useState(1); const [pages, setPages] = useState(1);
  const [moreLoading, setMoreLoading] = useState(false); const productsRequest = useRef(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [paymentChoice, setPaymentChoice] = useState<"unpaid" | "confirmed_unpaid">("unpaid");
  const [note, setNote] = useState(""); const [busy, setBusy] = useState(false); const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const pickCustomer = (customer: AdminCustomer) => {
    setCustomerId(customer.id); setName(customer.name ?? ""); setEmail(customer.email ?? ""); setPhone(customer.phone ?? "");
    setCustomers([]); setCustomerQ("");
  };
  useEffect(() => {
    if (!linkedCustomer) return;
    let active = true;
    void adminApi.customer(linkedCustomer).then((customer) => { if (active) pickCustomer(customer); })
      .catch((e) => { if (active) setError(e instanceof ApiError ? e.message : "Хэрэглэгч ачаалж чадсангүй."); });
    return () => { active = false; };
  }, [linkedCustomer]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setCustomers([]); setSearching(false);
      if (customerQ.trim().length < 2 || mode !== "search") return;
      setSearching(true);
      try { const result = await adminApi.customers({ q: customerQ.trim(), pageSize: 8 }); if (active) setCustomers(result.data); }
      catch (e) { if (active) setError(e instanceof ApiError ? e.message : "Хайж чадсангүй."); }
      finally { if (active) setSearching(false); }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [customerQ, mode]);
  useEffect(() => {
    if (!isFullAdmin(user?.role)) return;
    const requests = productsRequest; const request = ++requests.current;
    const timer = setTimeout(async () => {
      setLoading(true); setError(null);
      try {
        const list = await adminApi.products({ q: productQ.trim() || undefined, pageSize: 100 });
        if (request !== requests.current) return;
        setProducts(list.data); setPage(1); setPages(list.meta?.pages ?? 1);
      } catch (e) { if (request === requests.current) setError(e instanceof ApiError ? e.message : "Бараа ачаалж чадсангүй."); }
      finally { if (request === requests.current) setLoading(false); }
    }, 250);
    return () => { clearTimeout(timer); requests.current++; };
  }, [user?.role, productQ]);
  const loadMore = async () => {
    if (moreLoading) return;
    const request = productsRequest.current; setMoreLoading(true);
    try {
      const list = await adminApi.products({ q: productQ.trim() || undefined, page: page + 1, pageSize: 100 });
      if (request !== productsRequest.current) return;
      setProducts((prev) => [...prev, ...list.data.filter((p) => !prev.some((x) => x.id === p.id))]); setPage(page + 1);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй."); }
    finally { setMoreLoading(false); }
  };
  const rounds: RoundRow[] = products.flatMap((product) => (product.rounds ?? []).filter((round) => !round.deletedAt && round.ownerKind !== "LEASING" && ["ACTIVE", "CLOSED"].includes(round.status)).map((round) => ({ product, round })));
  const addRound = (row: RoundRow) => {
    if (lines.length >= 30) return;
    const selections = row.round.skuStocks?.find((s) => s.stock > 0)?.selections ?? Object.fromEntries(row.product.options.map((o) => [o.name, o.values[0] ?? ""]));
    setLines((prev) => [...prev, { ...row, selections: { ...selections }, key: crypto.randomUUID(), qty: 1 }]);
  };
  const customerValid = Boolean(customerId) || mode === "new" && validCustomerContact(email, phone);
  const lineError = lines.find((line) => {
    if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > 50 || priceOf(line) <= 0 || line.product.options.some((o) => !line.selections[o.name])) return true;
    if (line.round.type !== "ready") return false;
    const stock = selectedSkuStock(line.round.skuStocks, line.selections, line.product.options) ?? line.round.stock;
    if (stock == null) return false;
    const selectedQty = lines.filter((other) => other.round.id === line.round.id && (!line.round.skuStocks?.length || formatSelections(other.selections) === formatSelections(line.selections))).reduce((sum, other) => sum + other.qty, 0);
    return selectedQty > stock;
  });
  const itemsValid = lines.length > 0 && !lineError;
  const subtotal = lines.reduce((sum, line) => sum + priceOf(line) * line.qty, 0);
  const updateLine = (key: string, patch: Partial<Line>) => setLines((prev) => prev.map((line) => line.key === key ? { ...line, ...patch } : line));
  const submit = async () => {
    if (submitting.current || !customerValid || !itemsValid || step !== 2) return;
    submitting.current = true; setBusy(true); setError(null);
    try {
      const order = await adminApi.createOrder({ customerId: customerId ?? undefined, email: customerId ? undefined : email.trim() || undefined,
        phone: customerId ? undefined : phone.trim() || undefined, name: name.trim() || undefined, note: note.trim() || undefined,
        ...adminOrderPaymentChoice(paymentChoice), items: lines.map((line) => ({ productId: line.round.id, qty: line.qty, selections: line.selections })) });
      toast.success(order.code + " үүслээ."); router.push(workspaceHref("/workspace/shop", { order: order.id }));
    } catch (e) { const message = e instanceof ApiError ? e.message : "Үүсгэж чадсангүй."; setError(message); toast.error(message); }
    finally { submitting.current = false; setBusy(false); }
  };
  if (!isFullAdmin(user?.role)) return <Empty>Захиалга үүсгэх эрхгүй.</Empty>;
  return <div className="max-w-[1100px]">
    <PageHead title="Захиалга оруулах" hint="Хэрэглэгчээ сонгоод, бараагаа нэмээд, дүнгээ шалгаж үүсгэнэ." actions={<Link href="/workspace/shop" className="text-[13px] text-ink-2 underline">Захиалгууд</Link>} />
    <div className="mb-5 grid grid-cols-3 gap-2">{STEPS.map((label, index) => <button key={label} type="button" disabled={busy || index > step && (index === 1 ? !customerValid : !customerValid || !itemsValid)} onClick={() => setStep(index)} aria-current={step === index ? "step" : undefined}
      className={"flex min-h-14 items-center gap-2 rounded-xl border px-3 text-left text-[13px] " + (step === index ? "border-secondary bg-secondary-soft text-secondary" : "border-line bg-bg text-ink-2")}>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface text-[12px]">{index < step ? <Check className="h-3 w-3" /> : index + 1}</span>{label}</button>)}</div>
    {error && <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>}
    {step === 0 && <Card className="max-w-[640px] space-y-4 p-5">
      <h2 className="m-0 text-[17px] font-medium">Хэнд захиалга үүсгэх вэ?</h2>
      {customerId ? <div className="rounded-lg border border-ok bg-ok-bg p-4"><div className="font-medium">{name || "Хэрэглэгч"}</div><div className="mt-1 text-[13px]">{phoneLabel(phone)}{email ? " · " + email : ""}</div><Button size="sm" variant="ghost" className="mt-2" onClick={() => { setCustomerId(null); setName(""); setPhone(""); setEmail(""); }}>Өөр хэрэглэгч сонгох</Button></div> : <>
        <div className="flex flex-wrap gap-2"><Button variant={mode === "search" ? "primary" : "outline"} onClick={() => setMode("search")}>Бүртгэлтэй хэрэглэгч</Button><Button variant={mode === "new" ? "primary" : "outline"} onClick={() => { setMode("new"); if (/^[5-9]\d{7}$/.test(customerQ.trim())) setPhone(customerQ.trim()); }}>Шинэ хэрэглэгч</Button></div>
        {mode === "search" ? <><SearchField value={customerQ} onChange={(value) => { setCustomerQ(value); setCustomers([]); }} maxLength={60} placeholder="Утас, нэр, и-мэйлээр хайх" autoFocus />
          {searching ? <Skeleton className="h-20" /> : customers.length ? <div className="divide-y divide-line rounded-lg border border-line">{customers.map((customer) => <button key={customer.id} type="button" onClick={() => pickCustomer(customer)} className="flex min-h-16 w-full items-center justify-between px-4 py-3 text-left hover:bg-surface"><span><span className="block text-[14px] font-medium">{customer.name ?? "Нэргүй"}</span><span className="text-[12px] text-muted">{phoneLabel(customer.phone)}{customer.email ? " · " + customer.email : ""}</span></span><ChevronRight className="h-4 w-4" /></button>)}</div> : <p className="text-[13px] text-muted">{customerQ.trim().length >= 2 ? "Хэрэглэгч олдсонгүй. Шинэ хэрэглэгчээр үргэлжлүүлж болно." : "2-оос дээш тэмдэгт оруулж хайна."}</p>}</> : <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Утас" hint="Утас эсвэл и-мэйлээс нэг нь заавал"><Input value={phone} onChange={(v) => setPhone(v.replace(/\D/g, "").slice(0, 8))} inputMode="tel" placeholder="99112233" autoFocus /></Field>
          <Field label="Нэр"><Input value={name} onChange={setName} maxLength={80} placeholder="Хэрэглэгчийн нэр" /></Field>
          <div className="sm:col-span-2"><Field label="И-мэйл" hint="Утас оруулсан бол заавал биш"><Input value={email} onChange={setEmail} type="email" placeholder="user@gmail.com" /></Field></div>
        </div>}
      </>}
    </Card>}
    {step === 1 && <div className="grid items-start gap-5 lg:grid-cols-[1fr_1.1fr]">
      <Card className="p-4"><h2 className="mt-0 text-[16px] font-medium">Бараа нэмэх</h2><SearchField value={productQ} onChange={setProductQ} maxLength={60} placeholder="Барааны нэрээр хайх" />
        <div className="mt-3 max-h-[55dvh] divide-y divide-line overflow-y-auto">{loading ? <Skeleton className="h-40" /> : rounds.length === 0 ? <Empty>Тохирох гаргалт олдсонгүй.</Empty> : rounds.map((row) => <div key={row.round.id} className="flex items-center gap-3 py-3">
          <ProductImage src={row.product.images[0]} alt={row.product.name} className="h-12 w-12 shrink-0 rounded-lg" /><div className="min-w-0 flex-1"><div className="text-[14px] font-medium">{row.product.name}</div><div className="mt-1 text-[12px] text-muted">{row.round.type === "ready" ? "Бэлэн" : "Урьдчилсан"} · #{row.round.roundNo} · {money(row.round.sellPrice)}</div></div>
          <Button size="sm" variant="outline" aria-label={row.product.name + " нэмэх"} disabled={lines.length >= 30 || row.round.type === "ready" && (row.round.stock ?? 0) <= 0} onClick={() => addRound(row)}><Plus className="h-4 w-4" />Нэмэх</Button>
        </div>)}</div>{page < pages && <Button variant="outline" full className="mt-3" loading={moreLoading} onClick={() => void loadMore()}>Цааш үзэх</Button>}
      </Card>
      <Card className="p-4"><h2 className="mt-0 text-[16px] font-medium">Сонгосон бараа · {lines.length}</h2>{lines.length === 0 ? <Empty>Жагсаалтаас бараа нэмнэ.</Empty> : <div className="space-y-3">{lines.map((line) => <div key={line.key} className="rounded-lg border border-line p-3">
        <div className="flex items-start justify-between gap-2"><span className="text-[14px] font-medium">{line.product.name} · #{line.round.roundNo}</span><Button size="sm" variant="ghost" aria-label={line.product.name + " хасах"} onClick={() => setLines((prev) => prev.filter((item) => item.key !== line.key))}><Trash2 className="h-4 w-4" /></Button></div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">{line.product.options.map((option) => <Field key={option.name} label={option.name}><select value={line.selections[option.name] ?? ""} onChange={(event) => updateLine(line.key, { selections: { ...line.selections, [option.name]: event.target.value } })} className="h-11 w-full rounded-lg border border-line bg-bg px-3 text-[14px]">{option.values.map((value) => <option key={value} value={value}>{value}</option>)}</select></Field>)}</div>
        <div className="mt-3 flex items-center justify-between gap-2"><div className="flex items-center gap-1"><Button size="sm" variant="outline" aria-label={line.product.name + " тоог багасгах"} disabled={line.qty <= 1} onClick={() => updateLine(line.key, { qty: line.qty - 1 })}><Minus className="h-3 w-3" /></Button><Input className="w-16 text-center" aria-label={line.product.name + " ширхэг"} inputMode="numeric" value={String(line.qty)} onChange={(value) => { const qty = parseWholeQuantity(value, 50, false); if (qty != null) updateLine(line.key, { qty }); }} /><Button size="sm" variant="outline" aria-label={line.product.name + " тоог нэмэх"} disabled={line.qty >= 50} onClick={() => updateLine(line.key, { qty: line.qty + 1 })}><Plus className="h-3 w-3" /></Button></div><span className="tnum font-medium">{money(priceOf(line) * line.qty)}</span></div>
      </div>)}</div>}{lineError && <div className="mt-3"><ErrorNote>{lineError.product.name}: сонголт, үнэ эсвэл үлдэгдлээс хэтэрсэн тоогоо шалгана уу.</ErrorNote></div>}</Card>
    </div>}
    {step === 2 && <div className="grid items-start gap-5 lg:grid-cols-2"><Card className="p-5"><h2 className="mt-0 text-[17px] font-medium">Захиалгаа шалгах</h2><div className="mb-4 text-[14px]">{name || "Хэрэглэгч"} · {phoneLabel(phone)}{email ? " · " + email : ""}</div>
      <div className="divide-y divide-line">{lines.map((line) => <div key={line.key} className="flex justify-between gap-3 py-3"><div><div className="text-[14px] font-medium">{line.product.name}</div><div className="mt-1 text-[12px] text-muted">{formatSelections(line.selections)} · {line.qty} ш × {money(priceOf(line))}</div></div><span className="tnum shrink-0 text-[14px]">{money(priceOf(line) * line.qty)}</span></div>)}</div><p className="mt-3 border-t border-line pt-3 text-[13px] text-ink-2">Карго, хүргэлт, агуулахын хураамжийг тухайн үеийн тооцоогоор нэмж бодно.</p>
    </Card><Card className="space-y-4 p-5"><h2 className="m-0 text-[17px] font-medium">Төлбөрийн байдал</h2>
      {([{ id: "unpaid", label: "Төлбөр хүлээнэ", hint: "Шинэ захиалга үүснэ. Мөнгө орлогоор бүртгэхгүй." }, { id: "confirmed_unpaid", label: "Төлөөгүй ч баталгаажуулах", hint: "Үлдэгдэлтэй баталгаажсан захиалга үүснэ." }] as const).map((choice) => <label key={choice.id} className={"flex cursor-pointer items-start gap-3 rounded-lg border p-3 " + (paymentChoice === choice.id ? "border-secondary bg-secondary-soft" : "border-line")}><input type="radio" name="payment-choice" value={choice.id} checked={paymentChoice === choice.id} onChange={() => setPaymentChoice(choice.id)} className="mt-1" /><span><span className="block text-[14px] font-medium">{choice.label}</span><span className="mt-1 block text-[12px] text-ink-2">{choice.hint}</span></span></label>)}
      <Field label="Тэмдэглэл" hint="Заавал биш"><Input value={note} onChange={setNote} maxLength={500} placeholder="Жишээ: утсаар захиалсан" /></Field>
    </Card></div>}
    <div className="sticky bottom-3 z-10 mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-bg p-4"><div><span className="text-[12px] text-muted">{lines.reduce((sum, line) => sum + line.qty, 0)} ширхэг · Барааны дүн</span><div className="tnum text-[21px] font-medium">{money(subtotal)}</div></div>
      <div className="flex gap-2">{step > 0 && <Button variant="outline" disabled={busy} onClick={() => setStep(step - 1)}>Өмнөх</Button>}{step < 2 ? <Button disabled={step === 0 ? !customerValid : !itemsValid} onClick={() => setStep(step + 1)}>{step === 0 ? "Бараа сонгох" : "Захиалгаа шалгах"}<ChevronRight className="h-4 w-4" /></Button> : <Button loading={busy} disabled={!customerValid || !itemsValid} onClick={() => void submit()}>Захиалга үүсгэх</Button>}</div>
    </div>
  </div>;
}
