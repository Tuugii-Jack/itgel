import type {
  AdminBatch,
  AdminCategory,
  AdminCustomer,
  AdminDelivery,
  AdminOrderDetail,
  AdminOrderRow,
  AdminProduct,
  AdminSummary,
  Category,
  CreatedOrder,
  Me,
  MyOrder,
  PageMeta,
  Product,
  ProductReportRow,
  PublicOrder,
  RevenueReport,
  Settings,
  Slot,
  Store,
} from "./types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

interface Envelope<T> {
  data: T;
  meta?: PageMeta & Record<string, unknown>;
}

type Query = Record<string, string | number | boolean | undefined | null>;

function qs(query?: Query): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export const TOKEN_KEYS = {
  customer: "itgel.customer.token",
  admin: "itgel.admin.token",
} as const;

export function readToken(kind: keyof typeof TOKEN_KEYS): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEYS[kind]);
}

export function writeToken(
  kind: keyof typeof TOKEN_KEYS,
  token: string | null,
): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEYS[kind], token);
  else window.localStorage.removeItem(TOKEN_KEYS[kind]);
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Query;
  auth?: keyof typeof TOKEN_KEYS;
  /** Server component-ээс дуудахад кэш хийхгүй. */
  cache?: RequestCache;
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<Envelope<T>> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";

  if (options.auth) {
    const token = readToken(options.auth);
    if (token) headers.authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}${qs(options.query)}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: options.cache ?? "no-store",
    });
  } catch {
    throw new ApiError(
      0,
      "NETWORK",
      "Сервертэй холбогдож чадсангүй. Интернэтээ шалгана уу.",
    );
  }

  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!res.ok) {
    const error = json.error as
      | { code?: string; message?: string; details?: unknown }
      | undefined;
    throw new ApiError(
      res.status,
      error?.code ?? "ERROR",
      error?.message ?? "Алдаа гарлаа.",
      error?.details,
    );
  }

  return json as unknown as Envelope<T>;
}

/** Токен хүчингүй болсон эсэх — дахин нэвтрүүлэхэд ашиглана. */
export const isAuthError = (error: unknown): boolean =>
  error instanceof ApiError && (error.status === 401 || error.status === 403);

// ------------------------------ Хэрэглэгч ------------------------------

export const api = {
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

  slots: (days = 14) =>
    request<{ slots: Slot[]; districts: { district: string; fee: number }[] }>(
      "/delivery/slots",
      { query: { days } },
    ).then((r) => r.data),

  sendOtp: (phone: string) =>
    request<{
      phone: string;
      expiresInSec: number;
      resendAfterSec: number;
      devCode?: string;
    }>("/auth/otp", { method: "POST", body: { phone } }).then((r) => r.data),

  verifyOtp: (phone: string, code: string, name?: string) =>
    request<{ token: string; customer: { id: string; phone: string; name: string | null } }>(
      "/auth/verify",
      { method: "POST", body: { phone, code, name } },
    ).then((r) => r.data),

  createOrder: (body: {
    phone: string;
    name?: string;
    note?: string;
    items: { productId: string; qty: number; size?: string; color?: string }[];
  }) =>
    request<CreatedOrder>("/orders", { method: "POST", body }).then((r) => r.data),

  order: (code: string) =>
    request<PublicOrder>(`/orders/${code}`).then((r) => r.data),

  chooseFulfilment: (
    code: string,
    body: {
      type: "PICKUP" | "DELIVERY";
      district?: string;
      khoroo?: string;
      address?: string;
      day?: string;
    },
  ) =>
    request<{
      code: string;
      fulfilment: "PICKUP" | "DELIVERY";
      deliveryFee: number;
      dueAmount: number;
      delivery: PublicOrder["delivery"];
    }>(`/orders/${code}/fulfilment`, { method: "POST", body }).then((r) => r.data),

  me: () => request<Me>("/me", { auth: "customer" }).then((r) => r.data),

  updateMe: (body: Partial<{
    name: string | null;
    district: string | null;
    khoroo: string | null;
    addressText: string | null;
    notifyPayment: boolean;
    notifyArrival: boolean;
    notifyPromo: boolean;
  }>) =>
    request<Me>("/me", { method: "PATCH", body, auth: "customer" }).then(
      (r) => r.data,
    ),

  myOrders: () =>
    request<MyOrder[]>("/me/orders", { auth: "customer" }) as unknown as Promise<{
      data: MyOrder[];
      meta: PageMeta & { totalSpent: number; activeCount: number };
    }>,
};

// -------------------------------- Админ --------------------------------

const adminAuth = { auth: "admin" } as const;

export const adminApi = {
  login: (email: string, password: string) =>
    request<{
      token: string;
      user: { id: string; email: string; name: string; role: string };
    }>("/admin/auth/login", { method: "POST", body: { email, password } }).then(
      (r) => r.data,
    ),

  me: () =>
    request<{ id: string; email: string; name: string; role: string }>(
      "/admin/auth/me",
      adminAuth,
    ).then((r) => r.data),

  summary: () =>
    request<AdminSummary>("/admin/reports/summary", adminAuth).then((r) => r.data),

  products: (query?: Query) =>
    request<AdminProduct[]>("/admin/products", { ...adminAuth, query }),

  product: (id: string) =>
    request<AdminProduct>(`/admin/products/${id}`, adminAuth).then((r) => r.data),

  createProduct: (body: unknown) =>
    request<AdminProduct>("/admin/products", {
      ...adminAuth,
      method: "POST",
      body,
    }).then((r) => r.data),

  updateProduct: (id: string, body: unknown) =>
    request<AdminProduct>(`/admin/products/${id}`, {
      ...adminAuth,
      method: "PATCH",
      body,
    }).then((r) => r.data),

  deleteProduct: (id: string) =>
    request<{ deleted: number }>(`/admin/products/${id}`, {
      ...adminAuth,
      method: "DELETE",
    }).then((r) => r.data),

  bulkStatus: (ids: string[], status: string) =>
    request<{ updated: number }>("/admin/products/bulk-status", {
      ...adminAuth,
      method: "POST",
      body: { ids, status },
    }).then((r) => r.data),

  bulkDelete: (ids: string[]) =>
    request<{ deleted: number }>("/admin/products/bulk-delete", {
      ...adminAuth,
      method: "POST",
      body: { ids },
    }).then((r) => r.data),

  presignImage: (id: string, contentType: string) =>
    request<{
      uploadUrl: string;
      publicUrl: string;
      key: string;
      method: "PUT";
      headers: Record<string, string>;
      provider: string;
    }>(`/admin/products/${id}/images`, {
      ...adminAuth,
      method: "POST",
      body: { contentType },
    }).then((r) => r.data),

  saveImages: (id: string, images: string[]) =>
    request<{ images: string[] }>(`/admin/products/${id}/images`, {
      ...adminAuth,
      method: "PATCH",
      body: { images },
    }).then((r) => r.data),

  categories: () =>
    request<AdminCategory[]>("/admin/categories", adminAuth).then((r) => r.data),

  createCategory: (body: { name: string; isActive?: boolean; sortOrder?: number }) =>
    request<AdminCategory>("/admin/categories", {
      ...adminAuth,
      method: "POST",
      body,
    }).then((r) => r.data),

  updateCategory: (id: string, body: Partial<{ name: string; isActive: boolean; sortOrder: number }>) =>
    request<AdminCategory>(`/admin/categories/${id}`, {
      ...adminAuth,
      method: "PATCH",
      body,
    }).then((r) => r.data),

  deleteCategory: (id: string) =>
    request<{ id: string }>(`/admin/categories/${id}`, {
      ...adminAuth,
      method: "DELETE",
    }).then((r) => r.data),

  orders: (query?: Query) =>
    request<AdminOrderRow[]>("/admin/orders", { ...adminAuth, query }),

  order: (id: string) =>
    request<AdminOrderDetail>(`/admin/orders/${id}`, adminAuth).then((r) => r.data),

  setOrderStatus: (id: string, status: string, reason?: string) =>
    request<AdminOrderDetail>(`/admin/orders/${id}/status`, {
      ...adminAuth,
      method: "PATCH",
      body: { status, reason },
    }).then((r) => r.data),

  batches: (query?: Query) =>
    request<AdminBatch[]>("/admin/batches", { ...adminAuth, query }),

  batch: (id: string) =>
    request<
      AdminBatch & {
        orders: {
          id: string;
          code: string;
          status: string;
          subtotal: number;
          itemCount: number;
          customer: { name: string | null; phone: string };
        }[];
      }
    >(`/admin/batches/${id}`, adminAuth).then((r) => r.data),

  createBatch: (body: { name: string; orderIds?: string[]; weightKg?: number }) =>
    request<AdminBatch>("/admin/batches", { ...adminAuth, method: "POST", body }).then(
      (r) => r.data,
    ),

  advanceBatch: (id: string) =>
    request<AdminBatch & { ordersMoved: number }>(`/admin/batches/${id}/advance`, {
      ...adminAuth,
      method: "POST",
    }).then((r) => r.data),

  updateBatchOrders: (id: string, body: { add?: string[]; remove?: string[] }) =>
    request<{ added: number; removed: number }>(`/admin/batches/${id}/orders`, {
      ...adminAuth,
      method: "POST",
      body,
    }).then((r) => r.data),

  handoverLookup: (code: string) =>
    request<AdminOrderDetail & { canHandOver: boolean; blockReason: string | null }>(
      "/admin/handover/lookup",
      { ...adminAuth, query: { code } },
    ).then((r) => r.data),

  handoverComplete: (orderId: string, body?: { collectedAmount?: number; note?: string }) =>
    request<AdminOrderDetail>(`/admin/handover/${orderId}/complete`, {
      ...adminAuth,
      method: "POST",
      body: body ?? {},
    }).then((r) => r.data),

  deliveries: (query?: Query) =>
    request<AdminDelivery[]>("/admin/deliveries", { ...adminAuth, query }).then(
      (r) => r.data,
    ),

  updateDelivery: (id: string, body: Partial<{ courierName: string | null; status: string }>) =>
    request<unknown>(`/admin/deliveries/${id}`, {
      ...adminAuth,
      method: "PATCH",
      body,
    }).then((r) => r.data),

  customers: (query?: Query) =>
    request<AdminCustomer[]>("/admin/customers", { ...adminAuth, query }),

  customer: (id: string) =>
    request<
      AdminCustomer & {
        stats: {
          orderCount: number;
          totalSpent: number;
          handedOver: number;
          cancelled: number;
          lastOrderAt: string | null;
        };
        orders: (AdminOrderRow & { items: unknown[] })[];
      }
    >(`/admin/customers/${id}`, adminAuth).then((r) => r.data),

  revenue: (period: "3m" | "6m" | "1y") =>
    request<RevenueReport>("/admin/reports/revenue", {
      ...adminAuth,
      query: { period },
    }).then((r) => r.data),

  productReport: (period: "3m" | "6m" | "1y", limit = 20) =>
    request<ProductReportRow[]>("/admin/reports/products", {
      ...adminAuth,
      query: { period, limit },
    }).then((r) => r.data),

  settings: () =>
    request<Settings>("/admin/settings", adminAuth).then((r) => r.data),

  updateSettings: (body: Partial<Settings>) =>
    request<Settings>("/admin/settings", {
      ...adminAuth,
      method: "PATCH",
      body,
    }).then((r) => r.data),
};
