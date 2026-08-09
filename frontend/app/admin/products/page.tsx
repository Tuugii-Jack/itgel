"use client";

import { useCallback, useEffect, useState } from "react";
import { Metric, PageHead, Select, Table, Td, Th } from "@/components/admin/shared";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  ImagePlaceholder,
  Input,
  Spinner,
  type Tone,
} from "@/components/ui";
import { ProductForm } from "@/components/admin/ProductForm";
import { ProductImage } from "@/components/ProductImage";
import { adminApi, ApiError } from "@/lib/api";
import { arrivalLabel, countdown, money } from "@/lib/format";
import type { AdminCategory, AdminProduct, ProductStatus } from "@/lib/types";

const STATUS_LABEL: Record<ProductStatus, string> = {
  ACTIVE: "Идэвхтэй",
  HIDDEN: "Нуусан",
  DRAFT: "Ноорог",
  CLOSED: "Хаагдсан",
  SOLD_OUT: "Дууссан",
  ARCHIVED: "Архивласан",
};

const STATUS_TONE: Record<ProductStatus, Tone> = {
  ACTIVE: "ok",
  HIDDEN: "neutral",
  DRAFT: "neutral",
  CLOSED: "warn",
  SOLD_OUT: "danger",
  ARCHIVED: "neutral",
};

export default function ProductsPage() {
  const [rows, setRows] = useState<AdminProduct[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<AdminProduct | "new" | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, cats] = await Promise.all([
        adminApi.products({
          status: status || undefined,
          category: category || undefined,
          q: query || undefined,
          pageSize: 100,
        }),
        adminApi.categories(),
      ]);
      setRows(list.data);
      setCategories(cats);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setLoading(false);
    }
  }, [status, category, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const bulkStatus = async (next: ProductStatus) => {
    setBusy(true);
    try {
      await adminApi.bulkStatus([...selected], next);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Солиж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  const bulkDelete = async () => {
    setBusy(true);
    try {
      await adminApi.bulkDelete([...selected]);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Устгаж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <ProductForm
        product={editing === "new" ? null : editing}
        categories={categories}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await load();
        }}
      />
    );
  }

  const active = rows.filter((r) => r.status === "ACTIVE").length;
  const stockValue = rows.reduce((sum, r) => sum + r.costPrice * r.stock, 0);

  return (
    <div>
      <PageHead
        title="Бараа"
        hint="Анхны үнэ зөвхөн энд харагдана — хэрэглэгчид хэзээ ч гарахгүй."
        actions={<Button onClick={() => setEditing("new")}>Бараа нэмэх</Button>}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Нийт бараа" value={rows.length} />
        <Metric label="Идэвхтэй" value={active} tone="ok" />
        <Metric
          label="Захиалгын бараа"
          value={rows.filter((r) => r.type === "order").length}
        />
        <Metric label="Агуулахын өртөг" value={money(stockValue)} />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Select
          value={status}
          onChange={setStatus}
          placeholder="Бүх статус"
          options={(Object.keys(STATUS_LABEL) as ProductStatus[]).map((s) => ({
            value: s,
            label: STATUS_LABEL[s],
          }))}
        />
        <Select
          value={category}
          onChange={setCategory}
          placeholder="Бүх ангилал"
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
        />
        <div className="min-w-[200px] flex-1">
          <Input value={search} onChange={setSearch} placeholder="Барааны нэрээр хайх" />
        </div>
      </div>

      {selected.size > 0 && (
        <Card className="mb-4 flex flex-wrap items-center gap-3 p-3">
          <span className="text-[14px]">{selected.size} бараа сонгосон</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => bulkStatus("ACTIVE")} disabled={busy}>
              Идэвхжүүлэх
            </Button>
            <Button size="sm" variant="outline" onClick={() => bulkStatus("HIDDEN")} disabled={busy}>
              Нуух
            </Button>
            <Button size="sm" variant="danger" onClick={bulkDelete} disabled={busy}>
              Устгах
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Болих
            </Button>
          </div>
        </Card>
      )}

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner className="text-muted" />
        </div>
      ) : rows.length === 0 ? (
        <Empty>Бараа олдсонгүй.</Empty>
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th className="w-10">
                    <input
                      type="checkbox"
                      aria-label="Бүгдийг сонгох"
                      checked={selected.size === rows.length && rows.length > 0}
                      onChange={(e) =>
                        setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())
                      }
                    />
                  </Th>
                  <Th>Бараа</Th>
                  <Th>Анхны үнэ</Th>
                  <Th>Зарах үнэ</Th>
                  <Th>Ашиг</Th>
                  <Th>Үлдэгдэл</Th>
                  <Th>Гарт очих</Th>
                  <Th>Статус</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={selected.has(row.id) ? "bg-surface" : ""}>
                    <Td>
                      <input
                        type="checkbox"
                        aria-label={`${row.name} сонгох`}
                        checked={selected.has(row.id)}
                        onChange={() =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(row.id)) next.delete(row.id);
                            else next.add(row.id);
                            return next;
                          })
                        }
                      />
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-[6px] border border-line">
                          <ProductImage src={row.images[0]} alt={row.name} className="h-full w-full" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate">{row.name}</div>
                          <div className="text-[13px] text-muted">
                            {row.category?.name ?? "—"} ·{" "}
                            {row.type === "order" ? "Захиалгын" : "Бэлэн"}
                          </div>
                        </div>
                      </div>
                    </Td>
                    <Td className="tnum">{money(row.costPrice)}</Td>
                    <Td className="tnum">{money(row.sellPrice)}</Td>
                    <Td className="tnum">
                      {money(row.profit)}
                      <div className="text-[13px] text-ok">{row.marginPercent}%</div>
                    </Td>
                    <Td className="tnum">{row.type === "ready" ? row.stock : "—"}</Td>
                    <Td className="tnum text-[13px] text-ink-2">
                      {arrivalLabel(row)}
                      {row.closeAt && row.status === "ACTIVE" && (
                        <div className="text-warn">{countdown(row.closeAt)}</div>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                    </Td>
                    <Td>
                      <Button size="sm" variant="outline" onClick={() => setEditing(row)}>
                        Засах
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>

          <div className="flex flex-col gap-3 md:hidden">
            {rows.map((row) => (
              <Card key={row.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[15px] leading-[1.4]">{row.name}</div>
                    <div className="text-[13px] text-muted">{row.category?.name ?? "—"}</div>
                  </div>
                  <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-[13px]">
                  <div>
                    <div className="text-muted">Анхны</div>
                    <div className="tnum">{money(row.costPrice)}</div>
                  </div>
                  <div>
                    <div className="text-muted">Зарах</div>
                    <div className="tnum">{money(row.sellPrice)}</div>
                  </div>
                  <div>
                    <div className="text-muted">Ашиг</div>
                    <div className="tnum text-ok">{row.marginPercent}%</div>
                  </div>
                </div>
                <Button full variant="outline" className="mt-3" onClick={() => setEditing(row)}>
                  Засах
                </Button>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
