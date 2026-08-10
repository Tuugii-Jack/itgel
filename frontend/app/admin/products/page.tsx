"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { Metric, PageHead, Select, Table, Td, Th } from "@/components/admin/shared";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  Input,
  Spinner,
  type Tone,
} from "@/components/ui";
import { ProductForm } from "@/components/admin/ProductForm";
import { RoundForm } from "@/components/admin/RoundForm";
import { ProductImage } from "@/components/ProductImage";
import { adminApi, ApiError } from "@/lib/api";
import { arrivalLabel, countdown, money } from "@/lib/format";
import type { AdminCategory, AdminProduct, AdminRound, ProductStatus } from "@/lib/types";

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

/**
 * Бараа = загвар (нэр, зураг, хэмжээ), доор нь тойргууд (үнэ, огноо, төлөв).
 * Нэг барааг өдөр бүр дахин гаргахад шинэ тойрог нэмэгдэнэ.
 */
export default function ProductsPage() {
  const [rows, setRows] = useState<AdminProduct[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<AdminProduct | "new" | null>(null);
  const [roundFor, setRoundFor] = useState<{
    product: AdminProduct;
    round: AdminRound | null;
  } | null>(null);
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

  /** Төлөв нь тойрог дээр байдаг тул сонгосон барааны сүүлийн тойрогт үйлчилнэ. */
  const bulkStatus = async (next: ProductStatus) => {
    const roundIds = rows
      .filter((r) => selected.has(r.id))
      .map((r) => r.currentRound?.id)
      .filter((id): id is string => Boolean(id));
    if (roundIds.length === 0) return;

    setBusy(true);
    try {
      await adminApi.bulkStatus(roundIds, next);
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

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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

  const activeRounds = rows.filter((r) => r.currentRound?.status === "ACTIVE").length;
  const stockValue = rows.reduce(
    (sum, r) =>
      sum + r.rounds.reduce((s, round) => s + round.costPrice * round.stock, 0),
    0,
  );
  const totalRounds = rows.reduce((sum, r) => sum + r.roundCount, 0);

  return (
    <div>
      <PageHead
        title="Бараа"
        hint="Нэг барааг олон удаа гаргаж болно. Анхны үнэ хэрэглэгчид хэзээ ч харагдахгүй."
        actions={<Button onClick={() => setEditing("new")}>Бараа нэмэх</Button>}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Бараа" value={rows.length} />
        <Metric label="Зарагдаж буй" value={activeRounds} tone="ok" />
        <Metric label="Нийт гаргалт" value={totalRounds} sub="Бүх тойрог" />
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
          <span className="text-[14px]">
            {selected.size} бараа сонгосон
            <span className="ml-1 text-[13px] text-muted">
              — төлөв солих нь сүүлийн тойрогт хамаарна
            </span>
          </span>
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
          {/* Desktop — бараа мөр, дэлгэхэд тойргууд */}
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
                  <Th>Гаргалт</Th>
                  <Th>Зарах үнэ</Th>
                  <Th>Ашиг</Th>
                  <Th>Үлдэгдэл</Th>
                  <Th>Гарт очих</Th>
                  <Th>Статус</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const current = row.currentRound;
                  const open = expanded.has(row.id);
                  return (
                    // Fragment нь мөр + тойргуудыг нэг бүлэг болгож байгаа тул
                    // React-ийн key энд байх ёстой, доторх <tr> дээр биш.
                    <Fragment key={row.id}>
                      <tr className={selected.has(row.id) ? "bg-surface" : ""}>
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
                              <ProductImage
                                src={row.images[0]}
                                alt={row.name}
                                className="h-full w-full"
                              />
                            </div>
                            <div className="min-w-0">
                              <div className="truncate">{row.name}</div>
                              <div className="text-[13px] text-muted">
                                {row.category?.name ?? "—"}
                                {current && (
                                  <> · {current.type === "order" ? "Захиалгын" : "Бэлэн"}</>
                                )}
                              </div>
                            </div>
                          </div>
                        </Td>
                        <Td>
                          <button
                            type="button"
                            onClick={() => toggleExpanded(row.id)}
                            className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-ink underline"
                          >
                            {row.roundCount} удаа
                            {current ? ` (одоо #${current.roundNo})` : ""}
                          </button>
                        </Td>
                        <Td className="tnum">{current ? money(current.sellPrice) : "—"}</Td>
                        <Td className="tnum">
                          {current ? (
                            <>
                              {money(current.profit)}
                              <div className="text-[13px] text-ok">{current.marginPercent}%</div>
                            </>
                          ) : (
                            "—"
                          )}
                        </Td>
                        <Td className="tnum">
                          {current && current.type === "ready" ? current.stock : "—"}
                        </Td>
                        <Td className="tnum text-[13px] text-ink-2">
                          {current && arrivalLabel(current)}
                          {current?.closeAt && current.status === "ACTIVE" && (
                            <div className="text-warn">{countdown(current.closeAt)}</div>
                          )}
                        </Td>
                        <Td>
                          {current && (
                            <Badge tone={STATUS_TONE[current.status]}>
                              {STATUS_LABEL[current.status]}
                            </Badge>
                          )}
                        </Td>
                        <Td>
                          <div className="flex gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setRoundFor({ product: row, round: null })}
                            >
                              Дахин гаргах
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
                              Засах
                            </Button>
                          </div>
                        </Td>
                      </tr>

                      {open &&
                        row.rounds.map((round) => (
                          <tr key={round.id} className="bg-surface">
                            <Td>{null}</Td>
                            <Td className="text-[13px] text-ink-2">
                              <span className="tnum">#{round.roundNo}</span> гаргалт
                            </Td>
                            <Td className="tnum text-[13px] text-muted">
                              {round.closeAt
                                ? new Date(round.closeAt).toLocaleDateString("mn-MN")
                                : "Бэлэн"}
                            </Td>
                            <Td className="tnum text-[13px]">{money(round.sellPrice)}</Td>
                            <Td className="tnum text-[13px]">{round.marginPercent}%</Td>
                            <Td className="tnum text-[13px]">
                              {round.type === "ready" ? round.stock : "—"}
                            </Td>
                            <Td className="tnum text-[13px] text-muted">{arrivalLabel(round)}</Td>
                            <Td>
                              <Badge tone={STATUS_TONE[round.status]}>
                                {STATUS_LABEL[round.status]}
                              </Badge>
                            </Td>
                            <Td>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setRoundFor({ product: row, round })}
                              >
                                Тойрог засах
                              </Button>
                            </Td>
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </Table>
          </div>

          {/* Утас — карт */}
          <div className="flex flex-col gap-3 md:hidden">
            {rows.map((row) => {
              const current = row.currentRound;
              return (
                <Card key={row.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[15px] leading-[1.4]">{row.name}</div>
                      <div className="text-[13px] text-muted">
                        {row.category?.name ?? "—"} · {row.roundCount} удаа гарсан
                      </div>
                    </div>
                    {current && (
                      <Badge tone={STATUS_TONE[current.status]}>
                        {STATUS_LABEL[current.status]}
                      </Badge>
                    )}
                  </div>
                  {current && (
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[13px]">
                      <div>
                        <div className="text-muted">Анхны</div>
                        <div className="tnum">{money(current.costPrice)}</div>
                      </div>
                      <div>
                        <div className="text-muted">Зарах</div>
                        <div className="tnum">{money(current.sellPrice)}</div>
                      </div>
                      <div>
                        <div className="text-muted">Ашиг</div>
                        <div className="tnum text-ok">{current.marginPercent}%</div>
                      </div>
                    </div>
                  )}
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setRoundFor({ product: row, round: null })}
                    >
                      Дахин гаргах
                    </Button>
                    <Button variant="ghost" className="flex-1" onClick={() => setEditing(row)}>
                      Засах
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
