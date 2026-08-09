"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdBanner } from "@/components/AdBanner";
import { ProductCard } from "@/components/ProductCard";
import { Button, Card, Divider, Empty, ErrorNote, Input, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useCart } from "@/lib/cart";
import type { Ad, Category, Product, Store } from "@/lib/types";

/** Гадуур хажуугийн зай — өргөн дэлгэцэд агуулга 1120px орчим болно. */
const GUTTER = "px-4 sm:px-6 lg:px-10 xl:px-20";

export default function HomePage() {
  const cart = useCart();
  const [store, setStore] = useState<Store | null>(null);
  const [ads, setAds] = useState<Ad[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [orderItems, setOrderItems] = useState<Product[]>([]);
  const [readyItems, setReadyItems] = useState<Product[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.store(), api.categories(), api.ads()])
      .then(([s, c, a]) => {
        setStore(s);
        setCategories(c);
        setAds(a);
      })
      .catch((e: ApiError) => setError(e.message));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [order, ready] = await Promise.all([
        api.products({ type: "order", category: category ?? undefined, q: query || undefined, pageSize: 20, sort: "closing" }),
        api.products({ type: "ready", category: category ?? undefined, q: query || undefined, pageSize: 20 }),
      ]);
      setOrderItems(order.data);
      setReadyItems(ready.data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Бараа ачаалж чадсангүй.");
    } finally {
      setLoading(false);
    }
  }, [category, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const deposit = store?.depositPercent ?? 100;
  const nothing = !loading && orderItems.length === 0 && readyItems.length === 0;
  const filtering = category !== null || query !== "";

  return (
    <div className="page pb-24 sm:pb-16">
      <TopNav store={store} />

      <div className={`${GUTTER} border-b border-line bg-bg py-3 lg:hidden`}>
        <Input value={search} onChange={setSearch} placeholder="Бараа хайх" />
      </div>

      {/* Hero нь зөвхөн desktop-д — утсан дээр шууд бараа руу орно. */}
      {store && !filtering && (
        <div className="hidden lg:block">
          <Hero store={store} />
        </div>
      )}

      <div className={`no-scrollbar flex gap-2 overflow-x-auto ${GUTTER} pt-4 lg:pt-6`}>
        <Chip active={category === null} onClick={() => setCategory(null)}>
          Бүгд
        </Chip>
        {categories.map((c) => (
          <Chip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>
            {c.name}
          </Chip>
        ))}
      </div>

      {error && (
        <div className={`${GUTTER} pt-4`}>
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-20">
          <Spinner className="text-muted" />
        </div>
      )}

      {nothing && <Empty>Энэ ангилалд одоогоор бараа алга.</Empty>}

      {!loading && orderItems.length > 0 && (
        <Section
          id="order"
          title="Захиалгын бараа"
          hint="Одоо захиалж, 2-3 долоо хоногийн дараа авна"
          items={orderItems}
          deposit={deposit}
        />
      )}

      {!loading && readyItems.length > 0 && (
        <Section
          id="ready"
          title="Бэлэн бараа"
          hint="Агуулахад байгаа, шууд авах боломжтой"
          items={readyItems}
          deposit={deposit}
        />
      )}

      {store && <TrustBlock store={store} />}

      {cart.count > 0 && (
        <div className={`sticky bottom-0 z-20 border-t border-line bg-bg p-4 sm:static sm:border-0 ${GUTTER} sm:pb-4`}>
          <Link href="/cart" className="no-underline">
            <Button full size="lg" className="sm:mx-auto sm:max-w-[360px]">
              Сагс үзэх · {cart.count} бараа
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}

function TopNav({ store }: { store: Store | null }) {
  return (
    <header className={`sticky top-0 z-30 flex h-16 items-center gap-6 border-b border-line bg-bg ${GUTTER}`}>
      <Link href="/" className="no-underline">
        <span className="text-[20px] font-medium tracking-[-0.01em]">
          {store?.storeName ?? "itgel"}
        </span>
      </Link>

      <nav className="hidden items-center gap-1 lg:flex">
        <NavLink href="#order">Захиалгын бараа</NavLink>
        <NavLink href="#ready">Бэлэн бараа</NavLink>
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {store?.phone && (
          <a
            href={`tel:${store.phone.replace(/\D/g, "")}`}
            className="tnum hidden h-10 items-center rounded-[8px] px-3 text-[14px] text-ink-2 no-underline xl:inline-flex"
          >
            {store.phone}
          </a>
        )}
        <Link href="/profile" className="no-underline">
          <Button variant="outline" size="sm" className="h-10">
            Профайл
          </Button>
        </Link>
        <Link href="/t" className="no-underline">
          <Button variant="outline" size="sm" className="h-10">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#57534E" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1.8 5.2 8 2.2l6.2 3v5.6L8 13.8l-6.2-3z" />
              <path d="M1.8 5.2 8 8.2l6.2-3 M8 8.2v5.6" />
            </svg>
            <span className="hidden sm:inline">Захиалгаа хянах</span>
            <span className="sm:hidden">Хянах</span>
          </Button>
        </Link>
      </div>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      className="rounded-[8px] px-3 py-2 text-[14px] text-ink-2 no-underline hover:bg-surface hover:text-ink"
    >
      {children}
    </a>
  );
}

function Hero({ store }: { store: Store }) {
  return (
    <section className={`${GUTTER} pt-6`}>
      <div className="overflow-hidden rounded-[16px] border border-line bg-surface">
        <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1.2fr_1fr] lg:gap-10 lg:p-10">
          <div className="flex flex-col justify-center gap-3">
            <h1 className="m-0 text-[24px] font-medium leading-[1.3] lg:text-[32px]">
              Гадаадаас захиалж,
              <br />
              Улаанбаатарт хүлээлгэн өгнө
            </h1>
            <p className="m-0 max-w-[46ch] text-[14px] leading-[1.6] text-ink-2 lg:text-[15px]">
              Захиалгын бараа 2-3 долоо хоногт ирнэ, бэлэн бараа маргааш гарт очно.
              Бараа ирэхэд SMS-ээр мэдэгдэнэ.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <a href="#order" className="no-underline">
                <Button>Захиалгын бараа үзэх</Button>
              </a>
              <a href="#ready" className="no-underline">
                <Button variant="outline">Бэлэн бараа</Button>
              </a>
            </div>
          </div>

          <div className="grid gap-3 rounded-[12px] border border-line bg-bg p-5 sm:grid-cols-2 lg:grid-cols-1">
            <HeroFact label="Ажлын цаг" value={store.workHours} />
            <HeroFact label="Хаяг" value={store.address} />
            <HeroFact
              label="Утас"
              value={
                <a href={`tel:${store.phone.replace(/\D/g, "")}`} className="tnum">
                  {store.phone}
                </a>
              }
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroFact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12px] text-muted">{label}</div>
      <div className="text-[14px] leading-[1.5]">{value}</div>
    </div>
  );
}

function Chip({
  children,
  active,
  onClick,
}: {
  children: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-10 shrink-0 cursor-pointer whitespace-nowrap rounded-[8px] border px-4 text-[14px] leading-tight
        ${active ? "border-ink bg-ink text-white" : "border-line bg-bg text-ink"}`}
    >
      {children}
    </button>
  );
}

function Section({
  id,
  title,
  hint,
  items,
  deposit,
}: {
  id: string;
  title: string;
  hint: string;
  items: Product[];
  deposit: number;
}) {
  return (
    <section id={id} className="scroll-mt-20 pt-8 lg:pt-12">
      <div className={`flex items-end justify-between gap-4 ${GUTTER}`}>
        <div>
          <h2 className="m-0 text-[20px] font-medium leading-[1.3] lg:text-[28px]">{title}</h2>
          <p className="mt-1 mb-0 text-[13px] text-ink-2 lg:text-[15px]">{hint}</p>
        </div>
        <span className="hidden shrink-0 whitespace-nowrap text-[13px] text-muted sm:inline lg:text-[14px]">
          {items.length} бараа
        </span>
      </div>

      {/* 4 багана дээр карт ~270px — өргөн дэлгэцэд шахуу харагдахгүй. */}
      <div className={`grid grid-cols-2 gap-4 pt-5 sm:grid-cols-3 lg:grid-cols-4 ${GUTTER}`}>
        {items.map((product) => (
          <ProductCard key={product.id} product={product} depositPercent={deposit} />
        ))}
      </div>
    </section>
  );
}

function TrustBlock({ store }: { store: Store }) {
  return (
    <section className={`${GUTTER} pt-12`}>
      <Card surface className="p-6 lg:p-8">
        <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr] lg:gap-12">
          <div>
            <div className="text-[17px] font-medium lg:text-[20px]">Бид хаана байдаг вэ</div>
            <p className="mt-2 mb-0 text-[13px] leading-[1.6] text-ink-2">
              Бараа гэмтэлтэй ирсэн эсвэл захиалгатай тохирохгүй бол 7 хоногийн дотор
              буцаана.
            </p>
          </div>

          <div className="grid gap-3 text-[14px] sm:grid-cols-2">
            <InfoRow label="Хаяг" value={store.address} />
            <InfoRow label="Ажлын цаг" value={store.workHours} />
            <InfoRow
              label="Утас"
              value={
                <a href={`tel:${store.phone.replace(/\D/g, "")}`} className="tnum">
                  {store.phone}
                </a>
              }
            />
            {store.facebookUrl && (
              <InfoRow
                label="Facebook"
                value={
                  <a href={store.facebookUrl} target="_blank" rel="noreferrer">
                    {store.facebookUrl.replace(/^https?:\/\//, "")}
                  </a>
                }
              />
            )}
          </div>
        </div>

        <Divider className="my-5" />
        <p className="m-0 text-[13px] text-muted">
          © {new Date().getFullYear()} {store.storeName}
        </p>
      </Card>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12px] text-muted">{label}</div>
      <div className="leading-[1.5] text-ink">{value}</div>
    </div>
  );
}
