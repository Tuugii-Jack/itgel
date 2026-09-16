import { request, type Envelope } from "@/lib/api/client";
import type { Ad, Category, Product, Store } from "@/types";

export const shopCatalogApi = {
  home: () =>
    request<{
      store: Store;
      categories: Category[];
      ads: Ad[];
      order: Envelope<Product[]>;
      ready: Envelope<Product[]>;
    }>("/home").then((r) => r.data),

  categories: () => request<Category[]>("/categories").then((r) => r.data),

  products: (query?: {
    category?: string;
    type?: "order" | "ready";
    q?: string;
    page?: number;
    pageSize?: number;
    sort?: "new" | "priceAsc" | "priceDesc" | "closing";
  }) => request<Product[]>("/products", { query }),

  product: (id: string) =>
    request<Product>(`/products/${id}`).then((r) => r.data),

  store: () => request<Store>("/store").then((r) => r.data),

  ads: () => request<Ad[]>("/ads").then((r) => r.data),
};
