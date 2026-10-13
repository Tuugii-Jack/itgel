"use client";

import { deferEffect } from "@/lib/deferEffect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Metric,
  PageHead,
  ProductStatusBadge,
  Table,
  Td,
  Th,
} from "@/components/admin/shared";
import { LeasingReadyForm } from "@/components/leasing/ReadyForm";
import { ProductImage } from "@/components/ProductImage";
import { Button, Card, Empty, ErrorNote, Input, Skeleton } from "@/components/ui";
import { leasingApi, ApiError } from "@/lib/api";
import { isOwner } from "@/lib/admin-role";
import { useAdminSession } from "@/lib/admin-session";
import { useToast } from "@/lib/toast";
import type { AdminCategory, AdminProduct, AdminRound, ProductStatus } from "@/lib/types";
import { money } from "@/lib/format";

const OPEN_STATUSES: ProductStatus[] = ["ACTIVE", "HIDDEN", "DRAFT"];

export default function LeasingReadyPage() {
  const toast = useToast();
  const { user } = useAdminSession();
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const loadGeneration = useRef(0);
  const [editing, setEditing] = useState<AdminProduct | null | "new">(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [stock, setStock] = useState<{ onHand: number; reserved: number; available: number } | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError(null);
    void leasingApi.readyStock().then((value) => {
      if (generation === loadGeneration.current) setStock(value);
    }).catch(() => undefined);
    try {
      const [list, cats] = await Promise.all([
        leasingApi.products({ pageSize: 30, page, q: query || undefined }),
        leasingApi.categories(),
      ]);
      if (generation !== loadGeneration.current) return;
      setProducts(list.data); setPages(list.meta?.pages ?? 1);
      setCategories(cats);
    } catch (e) {
      if (generation !== loadGeneration.current) return;
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [query, page]);

  useEffect(() => {
    const requests = loadGeneration;
    const cancel = deferEffect(() => { void load(); });
    return () => { cancel(); requests.current++; };
  }, [load]);

  const rows = useMemo(() => {
    const out: { product: AdminProduct; round: AdminRound }[] = [];
    for (const product of products) {
      for (const round of product.rounds) {
        if (round.closeAt != null) continue;
        out.push({ product, round });
      }
    }
    return out.sort((a, b) => Date.parse(b.round.createdAt) - Date.parse(a.round.createdAt));
  }, [products]);

  const counts = useMemo(() => {
    let open = 0;
    let hidden = 0;
    for (const row of rows) {
      if (row.round.status === "HIDDEN") hidden += 1;
      else if (OPEN_STATUSES.includes(row.round.status)) open += 1;
    }
    return { open, hidden, total: rows.length };
  }, [rows]);

  const openEdit = async (product: AdminProduct) => {
    setBusyId(`edit:${product.id}`);
    try {
      setEditing(await leasingApi.product(product.id));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Барааг ачаалж чадсангүй.");
    } finally {
      setBusyId(null);
    }
  };

  const setStatus = async (row: { product: AdminProduct; round: AdminRound }, status: ProductStatus) => {
    setBusyId(row.round.id);
    try {
      await leasingApi.updateRound(row.round.id, { status });
      toast.success(status === "HIDDEN" ? "Нуулаа." : "Идэвхжүүллээ.");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Төлөв солигдсонгүй.");
    } finally {
      setBusyId(null);
    }
  };

  if (editing !== null) {
    return (
      <LeasingReadyForm
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

  return (
    <div>
      <PageHead
        title="Бэлэн бараа"
        hint={
          isOwner(user?.role)
            ? "Бүх лизингийн бэлэн бараа. Шинэ бараа нэмэхдээ эзэмшигч сонгоно."
            : "Өөрийн эзэмшлийн бэлэн бараа. Шинэ борлуулалтын төлбөр лизингийн дансанд орно."
        }
        actions={<Button disabled={loading || categories.length === 0} onClick={() => setEditing("new")}>Бэлэн бараа нэмэх</Button>}
      />
      <div className="mb-5 grid grid-cols-3 gap-3 lg:grid-cols-6">
        <Metric label="Ажиллаж буй" value={counts.open} tone="ok" />
        <Metric label="Нуусан" value={counts.hidden} />
        <Metric label="Нийт" value={counts.total} />
        <Metric label="Байгаа" value={stock?.onHand ?? "—"} />
        <Metric label="Түр нөөц" value={stock?.reserved ?? "—"} />
        <Metric label="Боломжтой" value={stock?.available ?? "—"} tone="ok" />
      </div>
      <div className="mb-4">
        <Input value={search} onChange={setSearch} placeholder="Нэрээр хайх" className="w-52" />
      </div>
      {pages > 1 && <div className="mb-4 flex items-center justify-end gap-3"><span className="text-[13px] text-muted">{page} / {pages}</span><Button variant="outline" disabled={loading || page <= 1} onClick={() => setPage((value) => value - 1)}>Өмнөх</Button><Button variant="outline" disabled={loading || page >= pages} onClick={() => setPage((value) => value + 1)}>Дараах</Button></div>}
      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-[12px]" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Empty>Өөрийн бэлэн бараа алга. Нэмэх эсвэл захиалгаас шилжүүлнэ үү.</Empty>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <thead>
              <tr>
                <Th>Бараа</Th>
                <Th>Үнэ</Th>
                <Th>Байгаа</Th>
                <Th>Нөөц</Th>
                <Th>Боломжтой</Th>
                <Th>Төлөв</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ product, round }) => (
                <tr key={round.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      {product.images[0] ? (
                        <ProductImage
                          src={product.images[0]}
                          alt=""
                          className="h-10 w-10 rounded-[6px] object-cover"
                        />
                      ) : (
                        <span className="h-10 w-10 rounded-[6px] bg-surface-2" />
                      )}
                      <div>
                        <div className="text-[14px]">{product.name}</div>
                        <div className="text-[12px] text-ink-2">{product.category?.name}</div>
                      </div>
                    </div>
                  </Td>
                  <Td className="tnum">{money(round.sellPrice)}</Td>
                  <Td className="tnum">{round.stock}</Td>
                  <Td className="tnum">{round.reserved ?? 0}</Td>
                  <Td className="tnum">{round.available ?? Math.max(0, round.stock - (round.reserved ?? 0))}</Td>
                  <Td>
                    <ProductStatusBadge status={round.status} />
                  </Td>
                  <Td>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button size="sm" variant="outline" loading={busyId === `edit:${product.id}`} onClick={() => void openEdit(product)}>
                        Засах
                      </Button>
                      {round.status === "HIDDEN" ? (
                        <Button
                          size="sm"
                          loading={busyId === round.id}
                          onClick={() => void setStatus({ product, round }, "ACTIVE")}
                        >
                          Идэвхжүүлэх
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          loading={busyId === round.id}
                          onClick={() => void setStatus({ product, round }, "HIDDEN")}
                        >
                          Нуух
                        </Button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
