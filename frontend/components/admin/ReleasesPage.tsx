"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Metric,
  PageHead,
  ProductStatusBadge,
  Table,
  Td,
  Th,
} from "@/components/admin/shared";
import { OrderDetail } from "@/components/admin/OrderDetail";
import { ReleaseForm } from "@/components/admin/ReleaseForm";
import { RoundBuyers } from "@/components/admin/RoundBuyers";
import { RoundForm } from "@/components/admin/RoundForm";
import { ProductImage } from "@/components/ProductImage";
import { Button, Card, Empty, ErrorNote, Input, Skeleton } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { countdown, dayTimeLabel } from "@/lib/format";
import { priceLabel, productClosed } from "@/lib/options";
import { useToast } from "@/lib/toast";
import type { AdminProduct, AdminRound, ProductStatus } from "@/lib/types";

type Tab = "open" | "closed" | "archived";
type ReleaseKind = "order" | "ready";

type ReleaseRow = {
  product: AdminProduct;
  round: AdminRound;
};

const OPEN_STATUSES: ProductStatus[] = ["ACTIVE", "HIDDEN", "DRAFT"];

function releaseFinished(round: AdminRound, now?: Date) {
  return round.status === "SOLD_OUT" || productClosed(round, now);
}

const COPY: Record<
  ReleaseKind,
  {
    title: string;
    hint: string;
    emptyOpen: string;
    midCol: string;
  }
> = {
  order: {
    title: "Урьдчилсан захиалга",
    hint: "Гаргалтын огноо, үнэ, захиалга. Шинэ үүсгэх товчоор урьдчилсан захиалга нэмнэ.",
    emptyOpen: "Ажиллаж буй урьдчилсан захиалга алга.",
    midCol: "Хаагдах",
  },
  ready: {
    title: "Бэлэн бараа",
    hint: "Үлдэгдэл, үнэ, захиалга. Шинэ үүсгэх товчоор бэлэн бараа гаргана.",
    emptyOpen: "Ажиллаж буй бэлэн бараа алга.",
    midCol: "Үлдэгдэл",
  },
};

/**
 * Гаргалтын амьдралын цикл — урьдчилсан эсвэл бэлэн.
 * Дэлгүүр нь зөвхөн тавиур; энд жагсаах / засах / хянах / архивлах.
 */
export function ReleasesPage({ kind }: { kind: ReleaseKind }) {
  const copy = COPY[kind];
  const toast = useToast();
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [tab, setTab] = useState<Tab>("open");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [roundFor, setRoundFor] = useState<ReleaseRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [buyersFor, setBuyersFor] = useState<string | null>(null);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const now = useMemo(() => new Date(nowMs), [nowMs]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      const list = await adminApi.products({
        type: kind,
        q: query || undefined,
        pageSize: 100,
      });
      setProducts(list.data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [query, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const allRows = useMemo<ReleaseRow[]>(() => {
    const rows: ReleaseRow[] = [];
    for (const product of products) {
      for (const round of product.rounds) {
        const isOrder = round.closeAt != null;
        if (kind === "order" && !isOrder) continue;
        if (kind === "ready" && isOrder) continue;
        rows.push({ product, round });
      }
    }
    return rows.sort(
      (a, b) => Date.parse(b.round.createdAt) - Date.parse(a.round.createdAt),
    );
  }, [products, kind]);

  const counts = useMemo(() => {
    let open = 0;
    let closed = 0;
    let archived = 0;
    for (const row of allRows) {
      if (row.round.status === "ARCHIVED") archived += 1;
      else if (releaseFinished(row.round, now)) closed += 1;
      else if (OPEN_STATUSES.includes(row.round.status)) open += 1;
    }
    return { open, closed, archived };
  }, [allRows, now]);

  const rows = useMemo(() => {
    return allRows.filter(({ round }) => {
      if (tab === "archived") return round.status === "ARCHIVED";
      if (tab === "closed") return releaseFinished(round, now);
      return OPEN_STATUSES.includes(round.status) && !productClosed(round, now);
    });
  }, [allRows, tab, now]);

  const canArchive = (round: AdminRound) =>
    round.status !== "ARCHIVED" &&
    (releaseFinished(round, now) ||
      round.orderedQty > 0 ||
      (kind === "ready" && round.stock === 0 && round.status === "ACTIVE"));

  const archive = async (row: ReleaseRow) => {
    if (
      !window.confirm(
        `"${row.product.name}" #${row.round.roundNo} гаргалтыг архивлах уу? Дэлгүүрээс харагдахгүй.`,
      )
    ) {
      return;
    }
    setBusyId(row.round.id);
    try {
      await adminApi.updateRound(row.round.id, { status: "ARCHIVED" });
      toast.success("Архивлагдлаа.");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Архивлаж чадсангүй.");
    } finally {
      setBusyId(null);
    }
  };

  if (openOrderId) {
    return (
      <OrderDetail
        orderId={openOrderId}
        onClose={() => setOpenOrderId(null)}
        onChanged={() => void load()}
      />
    );
  }

  if (buyersFor) {
    return (
      <RoundBuyers
        roundId={buyersFor}
        onClose={() => setBuyersFor(null)}
        onOpenOrder={(orderId) => {
          setBuyersFor(null);
          setOpenOrderId(orderId);
        }}
      />
    );
  }

  if (creating) {
    return (
      <ReleaseForm
        kind={kind === "order" ? "preorder" : "ready"}
        onClose={() => setCreating(false)}
        onSaved={async () => {
          setCreating(false);
          await load();
        }}
      />
    );
  }

  if (roundFor) {
    return (
      <RoundForm
        product={roundFor.product}
        round={roundFor.round}
        onClose={() => setRoundFor(null)}
        onSaved={async () => {
          setRoundFor(null);
          await load();
        }}
      />
    );
  }

  return (
    <div>
      <PageHead
        title={copy.title}
        hint={copy.hint}
        actions={
          <Button onClick={() => setCreating(true)}>
            {kind === "order" ? "Урьдчилсан захиалга үүсгэх" : "Бэлэн бараа гаргах"}
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-3 gap-3">
        <Metric label="Ажиллаж буй" value={counts.open} tone="ok" />
        <Metric
          label={kind === "ready" ? "Дууссан / хаагдсан" : "Хаагдсан"}
          value={counts.closed}
        />
        <Metric label="Архив" value={counts.archived} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(
          [
            { id: "open" as const, label: "Ажиллаж буй", count: counts.open },
            {
              id: "closed" as const,
              label: kind === "ready" ? "Дууссан" : "Хаагдсан",
              count: counts.closed,
            },
            { id: "archived" as const, label: "Архив", count: counts.archived },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`h-10 cursor-pointer rounded-[8px] border px-3 text-[14px]
              ${tab === t.id ? "border-ink bg-ink text-white" : "border-line bg-bg text-ink-2"}`}
          >
            {t.label}
            <span className="tnum ml-1.5 opacity-70">{t.count}</span>
          </button>
        ))}
        <div className="min-w-[200px] flex-1">
          <Input value={search} onChange={setSearch} placeholder="Барааны нэрээр хайх" />
        </div>
        {refreshing && <span className="text-[13px] text-muted">Шинэчилж байна…</span>}
      </div>

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {loading && products.length === 0 ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-[12px]" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Empty>
          {tab === "open"
            ? copy.emptyOpen
            : tab === "closed"
              ? kind === "ready"
                ? "Дууссан гаргалт алга."
                : "Хаагдсан гаргалт алга."
              : "Архивласан гаргалт алга."}
        </Empty>
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>Бараа</Th>
                  <Th>Үнэ</Th>
                  <Th>{copy.midCol}</Th>
                  <Th>Захиалга</Th>
                  {kind === "order" && <Th>Багц</Th>}
                  <Th>Статус</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ product, round }) => (
                  <tr key={round.id}>
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-[6px] border border-line">
                          <ProductImage
                            src={product.images[0]}
                            alt={product.name}
                            className="h-full w-full"
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate">{product.name}</div>
                          <div className="tnum text-[13px] text-muted">
                            #{round.roundNo} гаргалт
                            {product.category?.name ? ` · ${product.category.name}` : ""}
                          </div>
                        </div>
                      </div>
                    </Td>
                    <Td className="tnum whitespace-nowrap">
                      <div>{priceLabel(round.price, round.priceMax)}</div>
                    </Td>
                    <Td className="tnum min-w-[120px] text-[13px]">
                      {kind === "order" ? (
                        <>
                          {round.closeAt ? dayTimeLabel(round.closeAt) : "—"}
                          {round.closeAt && !productClosed(round, now) && round.status === "ACTIVE" && (
                            <div className="text-warn">{countdown(round.closeAt, now)}</div>
                          )}
                        </>
                      ) : (
                        `${round.stock} үлд`
                      )}
                    </Td>
                    <Td className="tnum text-[13px]">
                      {round.orderedQty > 0 ? (
                        <>
                          <div>{round.orderedQty} ш</div>
                          <div className="text-muted">{round.customerCount} хүн</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </Td>
                    {kind === "order" && (
                      <Td className="text-[13px]">
                        {round.batch ? (
                          <Link
                            href="/admin/batches"
                            className="text-ink-2 no-underline hover:underline"
                          >
                            {round.batch.name}
                          </Link>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </Td>
                    )}
                    <Td>
                      <ProductStatusBadge
                        status={productClosed(round, now) ? "CLOSED" : round.status}
                      />
                    </Td>
                    <Td className="whitespace-nowrap">
                      <div className="flex flex-wrap gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setBuyersFor(round.id)}
                        >
                          Захиалгууд
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setRoundFor({ product, round })}
                        >
                          Засах
                        </Button>
                        {canArchive(round) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={busyId === round.id}
                            disabled={busyId !== null}
                            onClick={() => void archive({ product, round })}
                          >
                            Архивлах
                          </Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>

          <div className="flex flex-col gap-3 md:hidden">
            {rows.map(({ product, round }) => (
              <Card key={round.id} className="p-4">
                <div className="flex items-start gap-3">
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-[8px] border border-line">
                    <ProductImage
                      src={product.images[0]}
                      alt={product.name}
                      className="h-full w-full"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-[15px] leading-[1.4]">{product.name}</div>
                      <ProductStatusBadge
                        status={productClosed(round, now) ? "CLOSED" : round.status}
                      />
                    </div>
                    <div className="mt-1 tnum text-[13px] text-muted">
                      #{round.roundNo} · {priceLabel(round.price, round.priceMax)}
                      {kind === "order" && round.closeAt
                        ? ` · ${dayTimeLabel(round.closeAt)}`
                        : kind === "ready"
                          ? ` · ${round.stock} үлд`
                          : ""}
                    </div>
                    {round.orderedQty > 0 && (
                      <div className="mt-1 text-[13px] text-ink-2">
                        {round.orderedQty} ш · {round.customerCount} хүн
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setBuyersFor(round.id)}
                  >
                    Захиалгууд
                  </Button>
                  <Button
                    variant="ghost"
                    className="flex-1"
                    onClick={() => setRoundFor({ product, round })}
                  >
                    Засах
                  </Button>
                  {canArchive(round) && (
                    <Button
                      variant="ghost"
                      className="flex-1"
                      loading={busyId === round.id}
                      disabled={busyId !== null}
                      onClick={() => void archive({ product, round })}
                    >
                      Архивлах
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
