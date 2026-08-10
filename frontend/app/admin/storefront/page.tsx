"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHead } from "@/components/admin/shared";
import { ProductForm } from "@/components/admin/ProductForm";
import { RoundForm } from "@/components/admin/RoundForm";
import { StorefrontCard, type ShelfItem } from "@/components/admin/StorefrontCard";
import { ProductImage } from "@/components/ProductImage";
import { Button, Card, Empty, ErrorNote, Input, Spinner, Toggle } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import type { AdminAd, AdminCategory, AdminProduct, AdminRound, ProductStatus } from "@/lib/types";

/** Хэрэглэгчид үнэхээр харагддаг төлвүүд — backend-ийн VISIBLE_STATUSES. */
const PUBLIC_STATUSES: ProductStatus[] = ["ACTIVE", "CLOSED", "SOLD_OUT"];

/**
 * Админ доторх дэлгүүр.
 *
 * Хүснэгт биш, дэлгүүр яг байгаагаараа харагдана: ангилал, «Захиалгын
 * бараа» / «Бэлэн бараа» хэсэг, ижил карт. Ялгаа нь ноорог, нуусан
 * бараа ч энд харагдаж, карт дээрээс шууд гаргах/нуух боломжтой.
 */
export default function StorefrontPage() {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [ads, setAds] = useState<AdminAd[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  /** Асаалттай үед зөвхөн хэрэглэгчид харагддагийг үлдээнэ. */
  const [asCustomer, setAsCustomer] = useState(false);
  const [editing, setEditing] = useState<AdminProduct | "new" | null>(null);
  const [roundFor, setRoundFor] = useState<{
    product: AdminProduct;
    round: AdminRound | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
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
    // Дэлгүүрийн анхдагч эрэмбэ — шинэ нь эхэнд.
    return items.sort(
      (a, b) => Date.parse(b.round.createdAt) - Date.parse(a.round.createdAt),
    );
  }, [products, category, asCustomer]);

  const orderItems = shelf.filter((i) => i.round.type === "order");
  const readyItems = shelf.filter((i) => i.round.type === "ready");
  const hiddenCount = shelf.filter((i) => !PUBLIC_STATUSES.includes(i.round.status)).length;

  /** Нэг товчоор гаргах/нуух. */
  const toggleVisible = async (item: ShelfItem) => {
    const next: ProductStatus = item.round.status === "ACTIVE" ? "HIDDEN" : "ACTIVE";
    setBusyId(item.round.id);
    setError(null);
    try {
      await adminApi.updateRound(item.round.id, { status: next });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Солиж чадсангүй.");
    } finally {
      setBusyId(null);
    }
  };

  const toggleAd = async (ad: AdminAd) => {
    setBusyId(ad.id);
    setError(null);
    try {
      await adminApi.updateAd(ad.id, { isActive: !ad.isActive });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Солиж чадсангүй.");
    } finally {
      setBusyId(null);
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
        hint="Дэлгүүр яг ийм харагдана. Картан дээрээс шууд гаргаж, нууж, дахин гаргана."
        actions={<Button onClick={() => setEditing("new")}>Бараа нэмэх</Button>}
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
      </div>

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {/* Дэлгүүрийн хамгийн дээд хэсэг — зарын самбар */}
      <AdStrip ads={ads} busyId={busyId} onToggle={toggleAd} asCustomer={asCustomer} />

      {/* Ангиллын чипүүд — дэлгүүртэй ижил */}
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

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner className="text-muted" />
        </div>
      ) : shelf.length === 0 ? (
        <Empty>
          {asCustomer
            ? "Хэрэглэгчид харагдах бараа алга. Ноорогоо гаргана уу."
            : "Бараа алга."}
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
            onNewRound={(item) => setRoundFor({ product: item.product, round: null })}
            onEditProduct={(item) => setEditing(item.product)}
            onAdd={() => setEditing("new")}
          />
          <Shelf
            title="Бэлэн бараа"
            hint="Агуулахад байгаа, шууд авах боломжтой"
            items={readyItems}
            busyId={busyId}
            onToggle={toggleVisible}
            onEditRound={(item) => setRoundFor({ product: item.product, round: item.round })}
            onNewRound={(item) => setRoundFor({ product: item.product, round: null })}
            onEditProduct={(item) => setEditing(item.product)}
            onAdd={() => setEditing("new")}
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
  onNewRound,
  onEditProduct,
  onAdd,
}: {
  title: string;
  hint: string;
  items: ShelfItem[];
  busyId: string | null;
  onToggle: (item: ShelfItem) => void;
  onEditRound: (item: ShelfItem) => void;
  onNewRound: (item: ShelfItem) => void;
  onEditProduct: (item: ShelfItem) => void;
  onAdd: () => void;
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
            onNewRound={() => onNewRound(item)}
            onEditProduct={() => onEditProduct(item)}
          />
        ))}
        <AddTile onClick={onAdd} />
      </div>
    </section>
  );
}

/** Сүүлд нь байрлах «нэмэх» хавтан — дэлгүүр дүүргэх урсгалыг тасалдуулахгүй. */
function AddTile({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[200px] cursor-pointer flex-col items-center justify-center gap-2
        rounded-[12px] border border-dashed border-line bg-surface text-ink-2 hover:bg-surface-2"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
      <span className="text-[14px]">Бараа нэмэх</span>
    </button>
  );
}

/** Дэлгүүрийн дээд талын зарууд — хэрэглэгч хамгийн түрүүнд үүнийг хардаг. */
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
