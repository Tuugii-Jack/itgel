"use client";

import { useCallback, useEffect, useState } from "react";
import { Metric, PageHead, Select, Table, Td, Th } from "@/components/admin/shared";
import { Button, Card, Empty, ErrorNote, Input, Skeleton } from "@/components/ui";
import { ProductForm } from "@/components/admin/ProductForm";
import { ReleaseForm, type ReleaseKind } from "@/components/admin/ReleaseForm";
import { ProductImage } from "@/components/ProductImage";
import { adminApi, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { formatOptionsSummary } from "@/lib/options";
import type { AdminCategory, AdminProduct } from "@/lib/types";

/**
 * Бараа = каталогийн загвар (нэр, зураг, хэмжээ).
 * Зарах гаргалт нь «Урьдчилсан захиалга үүсгэх» / «Бэлэн гаргах»-аар тусад нь.
 */
const PRODUCTS_PAGE_SIZE = 100;

export default function ProductsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<AdminProduct[]>([]);
  const [pageMeta, setPageMeta] = useState({ page: 1, pages: 1, total: 0 });
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<AdminProduct | "new" | null>(null);
  const [releasing, setReleasing] = useState<{
    kind: ReleaseKind;
    productId?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = busyAction !== null;

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchProducts = useCallback(
    (page: number) =>
      adminApi.products({
        category: category || undefined,
        q: query || undefined,
        page,
        pageSize: PRODUCTS_PAGE_SIZE,
      }),
    [category, query],
  );

  const load = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      const [list, cats] = await Promise.all([fetchProducts(1), adminApi.categories()]);
      setRows(list.data);
      setPageMeta({
        page: list.meta?.page ?? 1,
        pages: list.meta?.pages ?? 1,
        total: list.meta?.total ?? list.data.length,
      });
      setCategories(cats);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchProducts]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    setMoreLoading(true);
    try {
      const list = await fetchProducts(pageMeta.page + 1);
      setRows((prev) => [...prev, ...list.data]);
      setPageMeta({
        page: list.meta?.page ?? pageMeta.page + 1,
        pages: list.meta?.pages ?? pageMeta.pages,
        total: list.meta?.total ?? pageMeta.total,
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setMoreLoading(false);
    }
  };

  const bulkDelete = async () => {
    setBusyAction("delete");
    try {
      const result = await adminApi.bulkDelete([...selected]);
      toast.success(`${result.deleted} бараа устлаа.`);
      await load();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Устгаж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusyAction(null);
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

  if (releasing) {
    const releaseKind = releasing.kind;
    return (
      <ReleaseForm
        kind={releaseKind}
        initialProductId={releasing.productId}
        onClose={() => setReleasing(null)}
        onSaved={async () => {
          setReleasing(null);
          await load();
        }}
      />
    );
  }

  return (
    <div>
      <PageHead
        title="Бараа"
        hint="Каталог — нэр, зураг, сонголт. Гаргалтыг Урьдчилсан захиалга / Бэлэн бараа цэсээс удирдана."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setReleasing({ kind: "preorder" })}>
              Урьдчилсан захиалга үүсгэх
            </Button>
            <Button variant="outline" onClick={() => setReleasing({ kind: "ready" })}>
              Бэлэн гаргах
            </Button>
            <Button onClick={() => setEditing("new")}>Бараа нэмэх</Button>
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Metric label="Бараа" value={pageMeta.total || rows.length} />
        <Metric
          label="Ангилал"
          value={categories.length}
          sub="Нийт бүртгэлтэй"
        />
        <Metric
          label="Зурагтай"
          value={rows.filter((r) => r.images.length > 0).length}
          sub="Энэ хуудсанд"
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          value={category}
          onChange={setCategory}
          placeholder="Бүх ангилал"
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
        />
        <div className="min-w-[200px] flex-1">
          <Input value={search} onChange={setSearch} placeholder="Барааны нэрээр хайх" />
        </div>
        {refreshing && <span className="text-[13px] text-muted">Шинэчилж байна…</span>}
      </div>

      {selected.size > 0 && (
        <Card className="mb-4 flex flex-wrap items-center gap-3 p-3">
          <span className="text-[14px]">{selected.size} бараа сонгосон</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="danger"
              onClick={bulkDelete}
              disabled={busy}
              loading={busyAction === "delete"}
            >
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

      {loading && rows.length === 0 ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-[12px]" />
          ))}
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
                  <Th>Ангилал</Th>
                  <Th>Сонголт</Th>
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
                      <div className="flex items-center gap-2.5">
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-[6px] border border-line">
                          <ProductImage
                            src={row.images[0]}
                            alt={row.name}
                            className="h-full w-full"
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate">{row.name}</div>
                          <div className="text-[13px] text-muted">
                            {row.images.length} зураг
                          </div>
                        </div>
                      </div>
                    </Td>
                    <Td className="text-[13px]">{row.category?.name ?? "—"}</Td>
                    <Td className="max-w-[280px] text-[13px] text-ink-2">
                      <span className="line-clamp-2">{formatOptionsSummary(row.options)}</span>
                    </Td>
                    <Td className="whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
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
                <div className="flex items-start gap-3">
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-[8px] border border-line">
                    <ProductImage
                      src={row.images[0]}
                      alt={row.name}
                      className="h-full w-full"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] leading-[1.4]">{row.name}</div>
                    <div className="text-[13px] text-muted">
                      {row.category?.name ?? "—"}
                      {row.options?.length
                        ? ` · ${formatOptionsSummary(row.options)}`
                        : ""}
                    </div>
                  </div>
                </div>
                <div className="mt-3">
                  <Button variant="ghost" className="w-full" onClick={() => setEditing(row)}>
                    Засах
                  </Button>
                </div>
              </Card>
            ))}
          </div>

          {pageMeta.page < pageMeta.pages && (
            <div className="flex justify-center pt-4">
              <Button variant="outline" onClick={loadMore} loading={moreLoading}>
                Цааш үзэх · {pageMeta.total - rows.length} бараа
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
