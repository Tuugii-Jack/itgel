import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Ad, Category, Product, Store } from "@/lib/types";

export const ORDER_PREVIEW = 8;
export const PAGE_SIZE = 20;

export interface SectionData {
  items: Product[];
  total: number;
  page: number;
  pages: number;
}

const EMPTY_SECTION: SectionData = {
  items: [],
  total: 0,
  page: 1,
  pages: 1,
};

export function useHomeCatalog() {
  const [store, setStore] = useState<Store | null>(null);
  const [ads, setAds] = useState<Ad[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [orderData, setOrderData] = useState<SectionData>(EMPTY_SECTION);
  const [readyData, setReadyData] = useState<SectionData>(EMPTY_SECTION);

  const [category, setCategory] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState<"order" | "ready" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setBooting(true);
      setLoading(true);
      setError(null);
      try {
        const home = await api.home();
        if (!alive) return;
        setStore(home.store);
        setCategories(home.categories);
        setAds(home.ads);
        setOrderData({
          items: home.order.data,
          total: home.order.meta?.total ?? home.order.data.length,
          page: home.order.meta?.page ?? 1,
          pages: home.order.meta?.pages ?? 1,
        });
        setReadyData({
          items: home.ready.data,
          total: home.ready.meta?.total ?? home.ready.data.length,
          page: home.ready.meta?.page ?? 1,
          pages: home.ready.meta?.pages ?? 1,
        });
      } catch (e) {
        if (alive) {
          setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
        }
      } finally {
        if (alive) {
          setLoading(false);
          setBooting(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const skipCategoryReload = useRef(true);

  const fetchSection = useCallback(
    async (type: "order" | "ready", page: number, pageSize = PAGE_SIZE) => {
      const result = await api.products({
        type,
        category: category ?? undefined,
        page,
        pageSize,
        sort: type === "order" ? "closing" : undefined,
      });

      return {
        items: result.data,
        total: result.meta?.total ?? result.data.length,
        page: result.meta?.page ?? page,
        pages: result.meta?.pages ?? 1,
      };
    },
    [category],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [order, ready] = await Promise.all([
        fetchSection("order", 1, ORDER_PREVIEW),
        fetchSection("ready", 1),
      ]);

      setOrderData(order);
      setReadyData(ready);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Бараа ачаалж чадсангүй.");
    } finally {
      setLoading(false);
    }
  }, [fetchSection]);

  useEffect(() => {
    if (booting) return;
    if (skipCategoryReload.current) {
      skipCategoryReload.current = false;
      return;
    }
    void load();
  }, [booting, load]);

  const loadMore = async (type: "order" | "ready") => {
    const data = type === "order" ? orderData : readyData;

    const set = type === "order" ? setOrderData : setReadyData;

    setMoreLoading(type);

    try {
      const next = await fetchSection(type, data.page + 1);

      set({
        ...next,
        items: [...data.items, ...next.items],
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Бараа ачаалж чадсангүй.");
    } finally {
      setMoreLoading(null);
    }
  };

  const nothing =
    !loading && orderData.items.length === 0 && readyData.items.length === 0;

  const filtering = category !== null;

  return {
    store,
    ads,
    categories,
    orderData,
    readyData,
    category,
    setCategory,
    booting,
    loading,
    moreLoading,
    error,
    loadMore,
    nothing,
    filtering,
  };
}
