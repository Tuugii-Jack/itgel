"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHead } from "@/components/admin/shared";
import { OrderDetail } from "@/components/admin/OrderDetail";
import { ProductForm } from "@/components/admin/ProductForm";
import { RoundBuyers } from "@/components/admin/RoundBuyers";
import { RoundForm } from "@/components/admin/RoundForm";
import { StorefrontCard, type ShelfItem } from "@/components/admin/StorefrontCard";
import { ProductImage } from "@/components/ProductImage";
import { Button, Card, Empty, ErrorNote, Input, Skeleton, Toggle } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type { AdminAd, AdminCategory, AdminProduct, AdminRound, ProductStatus } from "@/lib/types";

/** Хэрэглэгчид үнэхээр харагддаг төлвүүд — backend-ийн VISIBLE_STATUSES. */
const PUBLIC_STATUSES: ProductStatus[] = ["ACTIVE", "CLOSED", "SOLD_OUT"];

/**
 * Дэлгүүр — хэрэглэгчид харагдаж буй зүйлийн амьд харагдах байдал.
 *
 * Бараа үүсгэх, багцад нэмэх нь энд биш: Бараа / Багц хэсэгт хийнэ.
 * Эндээс зөвхөн гаргах/нуух, үнэ/огноо засах, хэн авсныг харна.
 */
export default function StorefrontPage() {
  const toast = useToast();
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [ads, setAds] = useState<AdminAd[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  /** Асаалттай үед зөвхөн хэрэглэгчид харагддагийг үлдээнэ. */
  const [asCustomer, setAsCustomer] = useState(false);
  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [roundFor, setRoundFor] = useState<{
    product: AdminProduct;
    round: AdminRound;
  } | null>(null);
  const [buyersFor, setBuyersFor] = useState<string | null>(null);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      const [list, cats, adList] = await Promise.all([
        adminApi.products({ q: query || undefined, pageSize: 100 }),
        adminApi.categories(),
        adminApi.ads(),
      ]);
      setProducts(list.data);
      setCategories(cats);
      setAds(adList);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Бараануудыг тойрог болгон задална — дэлгүүрт нэг тойрог = нэг карт.
   * Дэлгүүрийн жинхэнэ дүрмийг давтана: идэвхтэй тойрог байвал тухайн
   * барааны хуучин хаагдсан тойргийг харуулахгүй (backend-тэй ижил).
   */
  const shelf = useMemo<ShelfItem[]>(() => {
    const items: ShelfItem[] = [];
    for (const product of products) {
      if (category && product.categoryId !== category) continue;
      const hasActiveRound = product.rounds.some((r) => r.status === "ACTIVE");

      for (const round of product.rounds) {
        if (hasActiveRound && round.status !== "ACTIVE") continue;
        if (asCustomer && !PUBLIC_STATUSES.includes(round.status)) continue;
        items.push({ round, product, hasActiveRound });
      }
    }
    return items.sort(
      (a, b) => Date.parse(b.round.createdAt) - Date.parse(a.round.createdAt),
    );
  }, [products, category, asCustomer]);

  const orderItems = shelf.filter((i) => i.round.type === "order");
  const readyItems = shelf.filter((i) => i.round.type === "ready");
  const hiddenCount = shelf.filter((i) => !PUBLIC_STATUSES.includes(i.round.status)).length;

  /** Нэг товчоор гаргах/нуух — карт дээр шууд шинэчилнэ, бүх жагсаалтыг дахин татахгүй. */
  const toggleVisible = async (item: ShelfItem) => {
    const next: ProductStatus = item.round.status === "ACTIVE" ? "HIDDEN" : "ACTIVE";
    setBusyId(item.round.id);
    setError(null);
    try {
      const updated = await adminApi.updateRound(item.round.id, { status: next });
      setProducts((prev) =>
        prev.map((p) =>
          p.id !== item.product.id
            ? p
            : {
                ...p,
                rounds: p.rounds.map((r) =>
                  r.id === item.round.id ? { ...r, ...updated, status: next } : r,
                ),
                currentRound:
                  p.currentRound?.id === item.round.id
                    ? { ...p.currentRound, ...updated, status: next }
                    : p.currentRound,
              },
        ),
      );
      toast.success(next === "ACTIVE" ? "Дэлгүүрт гарлаа." : "Дэлгүүрээс нуугдлаа.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Солиж чадсангүй.");
    } finally {
      setBusyId(null);
    }
  };

  const toggleAd = async (ad: AdminAd) => {
    setBusyId(ad.id);
    try {
      const updated = await adminApi.updateAd(ad.id, { isActive: !ad.isActive });
      setAds((prev) => prev.map((a) => (a.id === ad.id ? { ...a, ...updated } : a)));
      toast.success(ad.isActive ? "Баннер нуугдлаа." : "Баннер идэвхжлээ.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Солиж чадсангүй.");
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

  if (editing) {
    return (
      <ProductForm
        product={editing}
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

  return (
    <div>
      <PageHead
        title="Дэлгүүр"
        hint="Хэрэглэгчид яг ингэж харна. Гаргалт удирдах — Урьдчилсан захиалга цэсээс."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/preorders"
              className="inline-flex h-11 items-center rounded-[8px] border border-line bg-bg px-4 text-[14px] no-underline"
            >
              Урьдчилсан захиалга
            </Link>
            <Link
              href="/admin/products"
              className="inline-flex h-11 items-center rounded-[8px] border border-line bg-bg px-4 text-[14px] no-underline"
            >
              Каталог
            </Link>
            <Link
              href="/admin/batches"
              className="inline-flex h-11 items-center rounded-[8px] bg-ink px-4 text-[14px] text-white no-underline"
            >
              Багцад бараа нэмэх
            </Link>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-[220px] flex-1">
          <Input value={search} onChange={setSearch} placeholder="Барааны нэрээр хайх" />
        </div>
        <Toggle
          label="Хэрэглэгчийн нүдээр"
          hint={
            hiddenCount > 0
              ? `${hiddenCount} бараа хэрэглэгчид харагдахгүй`
              : "Бүх бараа нийтэд харагдаж байна"
          }
          checked={asCustomer}
          onChange={setAsCustomer}
        />
        {refreshing && <span className="text-[13px] text-muted">Шинэчилж байна…</span>}
      </div>

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <AdStrip ads={ads} busyId={busyId} onToggle={toggleAd} asCustomer={asCustomer} />

      <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto">
        <Chip active={category === null} onClick={() => setCategory(null)}>
          Бүгд
        </Chip>
        {categories.map((c) => (
          <Chip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>
            {c.name}
          </Chip>
        ))}
      </div>

      {loading && products.length === 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[3/4] rounded-[12px]" />
          ))}
        </div>
      ) : shelf.length === 0 ? (
        <Empty>
          {asCustomer
            ? "Хэрэглэгчид харагдах бараа алга."
            : "Дэлгүүрт бараа алга. Багцад бараа нэмээд эхлүүлнэ үү."}
        </Empty>
      ) : (
        <div className="flex flex-col gap-10">
          <Shelf
            title="Захиалгын бараа"
            hint="Хугацаа дуусмагц захиалга хаагдана"
            items={orderItems}
            busyId={busyId}
            onToggle={toggleVisible}
            onEditRound={(item) => setRoundFor({ product: item.product, round: item.round })}
            onEditProduct={(item) => setEditing(item.product)}
            onOpenBuyers={(item) => setBuyersFor(item.round.id)}
          />
          <Shelf
            title="Бэлэн бараа"
            hint="Агуулахад байгаа, шууд авах боломжтой"
            items={readyItems}
            busyId={busyId}
            onToggle={toggleVisible}
            onEditRound={(item) => setRoundFor({ product: item.product, round: item.round })}
            onEditProduct={(item) => setEditing(item.product)}
            onOpenBuyers={(item) => setBuyersFor(item.round.id)}
          />
        </div>
      )}
    </div>
  );
}

function Shelf({
  title,
  hint,
  items,
  busyId,
  onToggle,
  onEditRound,
  onEditProduct,
  onOpenBuyers,
}: {
  title: string;
  hint: string;
  items: ShelfItem[];
  busyId: string | null;
  onToggle: (item: ShelfItem) => void;
  onEditRound: (item: ShelfItem) => void;
  onEditProduct: (item: ShelfItem) => void;
  onOpenBuyers: (item: ShelfItem) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-[20px] font-medium leading-[1.3]">{title}</h2>
        <span className="text-[13px] text-muted">
          {hint} · {items.length}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => (
          <StorefrontCard
            key={item.round.id}
            item={item}
            busy={busyId === item.round.id}
            onToggle={() => onToggle(item)}
            onEditRound={() => onEditRound(item)}
            onEditProduct={() => onEditProduct(item)}
            onOpenBuyers={() => onOpenBuyers(item)}
          />
        ))}
      </div>
    </section>
  );
}

function AdStrip({
  ads,
  busyId,
  onToggle,
  asCustomer,
}: {
  ads: AdminAd[];
  busyId: string | null;
  onToggle: (ad: AdminAd) => void;
  asCustomer: boolean;
}) {
  const visible = asCustomer ? ads.filter((a) => a.isActive) : ads;
  if (visible.length === 0) return null;

  return (
    <Card className="mb-5 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-[14px] font-medium">Зарын самбар</span>
        <span className="text-[13px] text-muted">
          {ads.filter((a) => a.isActive).length} идэвхтэй
        </span>
      </div>
      <div className="no-scrollbar flex gap-3 overflow-x-auto">
        {visible.map((ad) => (
          <div key={ad.id} className="w-[220px] shrink-0">
            <div
              className={`overflow-hidden rounded-[8px] border border-line ${
                ad.isActive ? "" : "opacity-45"
              }`}
            >
              <div className="aspect-[3/1] bg-surface">
                <ProductImage src={ad.imageUrl} alt={ad.title} className="h-full w-full" />
              </div>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="truncate text-[13px] text-ink-2">{ad.title || "Нэргүй"}</span>
              <Button
                size="sm"
                variant="ghost"
                disabled={busyId === ad.id}
                onClick={() => onToggle(ad)}
              >
                {ad.isActive ? "Нуух" : "Гаргах"}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 shrink-0 cursor-pointer whitespace-nowrap rounded-[8px] border px-3.5 text-[14px]
        ${active ? "border-ink bg-ink text-white" : "border-line bg-bg text-ink"}`}
    >
      {children}
    </button>
  );
}
