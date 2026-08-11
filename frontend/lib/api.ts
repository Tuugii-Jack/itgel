import type {
  Ad,
  AdminAd,
  AdminBatch,
  AdminBatchDetail,
  AdminCategory,
  AdminCustomer,
  AdminDelivery,
  AdminOrderDetail,
  AdminOrderRow,
  AdminProduct,
  AdminRound,
  AdminSummary,
  ArchiveCalendar,
  ArchiveCustomer,
  ArchiveDay,
  ArchiveProduct,
  ArchiveSearch,
  AuditLog,
  BatchProduct,
  BatchSummary,
  Category,
  CreatedOrder,
  HandoverCustomer,
  Me,
  MyOrder,
  OrderTotals,
  PageMeta,
  Payment,
  PaymentLedger,
  PaymentMethod,
  Product,
  ProductReportRow,
  PublicOrder,
  RevenueReport,
  RoundOrders,
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

/** Middleware-д унших cookie — JWT биш, зөвхөн «нэвтэрсэн эсэх» тэмдэг. */
export const ADMIN_SESSION_COOKIE = "itgel_admin_session";

export function readToken(kind: keyof typeof TOKEN_KEYS): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEYS[kind]);
}

function syncAdminSessionCookie(token: string | null): void {
  if (typeof document === "undefined") return;
  const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  if (token) {
    // 30 хоног — JWT-ийн хугацаатай ойролцоо; гарахад cookie арилна.
    document.cookie = `${ADMIN_SESSION_COOKIE}=1; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax${secure}`;
  } else {
    // Max-Age=0 + Expires — бүх browser дээр найдвартай арилгана.
    document.cookie = `${ADMIN_SESSION_COOKIE}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax${secure}`;
  }
}

export function writeToken(
  kind: keyof typeof TOKEN_KEYS,
  token: string | null,
): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEYS[kind], token);
  else window.localStorage.removeItem(TOKEN_KEYS[kind]);
  if (kind === "admin") syncAdminSessionCookie(token);
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

  ads: () => request<Ad[]>("/ads").then((r) => r.data),

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

  register: (body: { email: string; password: string; name?: string; phone: string }) =>
    request<{
      email: string;
      expiresInSec: number;
      resendAfterSec: number;
      message?: string;
      devCode?: string;
    }>("/auth/register", { method: "POST", body }).then((r) => r.data),

  login: (login: string, password: string) =>
    request<{
      token: string;
      customer: {
        id: string;
        email: string;
        phone: string | null;
        name: string | null;
        emailVerified: boolean;
        hasPassword: boolean;
      };
    }>("/auth/login", { method: "POST", body: { login, password } }).then((r) => r.data),

  verifyEmail: (email: string, code: string) =>
    request<{
      token: string;
      customer: {
        id: string;
        email: string;
        phone: string | null;
        name: string | null;
        emailVerified: boolean;
        hasPassword: boolean;
      };
    }>("/auth/email/verify", { method: "POST", body: { email, code } }).then((r) => r.data),

  resendEmailCode: (email: string) =>
    request<{
      email: string;
      expiresInSec: number;
      resendAfterSec: number;
      devCode?: string;
    }>("/auth/email/resend", { method: "POST", body: { email } }).then((r) => r.data),

  forgotPassword: (email: string) =>
    request<{
      email: string;
      expiresInSec: number;
      resendAfterSec: number;
      message?: string;
      devCode?: string;
    }>("/auth/password/forgot", { method: "POST", body: { email } }).then((r) => r.data),

  resetPassword: (email: string, code: string, password: string) =>
    request<{
      token: string;
      customer: {
        id: string;
        email: string;
        phone: string | null;
        name: string | null;
        emailVerified: boolean;
        hasPassword: boolean;
      };
    }>("/auth/password/reset", { method: "POST", body: { email, code, password } }).then(
      (r) => r.data,
    ),

  createOrder: (body: {
    name?: string;
    note?: string;
    items: {
      productId: string;
      qty: number;
      selections?: Record<string, string>;
      size?: string;
      color?: string;
    }[];
  }) =>
    request<CreatedOrder>("/orders", { method: "POST", body, auth: "customer" }).then(
      (r) => r.data,
    ),

  order: (code: string) =>
    request<PublicOrder>(`/orders/${code}`).then((r) => r.data),

  /**
   * "Мөнгө шилжүүлсэн" гэж мэдэгдэх. Төлбөр орсонд тооцогдохгүй — админ
   * дансаа шалгаад дэвтэрт бүртгэх хүртэл захиалга төлөгдөөгүй хэвээр.
   */
  claimPayment: (code: string) =>
    request<{ code: string; paymentClaimedAt: string | null }>(
      `/orders/${code}/payment-claim`,
      { method: "POST" },
    ).then((r) => r.data),

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
    phone: string | null;
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

  changePassword: (currentPassword: string, newPassword: string) =>
    request<Me>("/me/password", {
      method: "POST",
      body: { currentPassword, newPassword },
      auth: "customer",
    }).then((r) => r.data),

  changeEmail: (email: string, password: string) =>
    request<{
      email: string;
      expiresInSec: number;
      resendAfterSec: number;
      message?: string;
      devCode?: string;
    }>("/me/email/change", {
      method: "POST",
      body: { email, password },
      auth: "customer",
    }).then((r) => r.data),

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

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>("/admin/auth/password", {
      ...adminAuth,
      method: "POST",
      body: { currentPassword, newPassword },
    }).then((r) => r.data),

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

  /** Төлөв нь ТОЙРОГ дээр байдаг тул id-нууд нь тойргийнх. */
  bulkStatus: (roundIds: string[], status: string) =>
    request<{ updated: number }>("/admin/rounds/bulk-status", {
      ...adminAuth,
      method: "POST",
      body: { ids: roundIds, status },
    }).then((r) => r.data),

  // --- Барааны тойрог («дахин гаргах») ---

  /** Шинэ гаргалт. Үнэ, хүлээх хоногийг өгөхгүй бол сүүлийн гаргалтынхыг авна. */
  createRound: (
    productId: string,
    body?: {
      costPrice?: number;
      sellPrice?: number;
      stock?: number;
      closeAt?: string | null;
      leadMinDays?: number;
      leadMaxDays?: number;
      status?: string;
      note?: string;
      batchId?: string | null;
    },
  ) =>
    request<AdminProduct>(`/admin/products/${productId}/rounds`, {
      ...adminAuth,
      method: "POST",
      body: body ?? {},
    }).then((r) => r.data),

  updateRound: (
    roundId: string,
    body: Partial<{
      costPrice: number;
      sellPrice: number;
      stock: number;
      closeAt: string | null;
      leadMinDays: number;
      leadMaxDays: number;
      status: string;
      note: string | null;
      batchId: string | null;
    }>,
  ) =>
    request<AdminRound>(`/admin/rounds/${roundId}`, {
      ...adminAuth,
      method: "PATCH",
      body,
    }).then((r) => r.data),

  /** Энэ гаргалтыг хэн хэн авсан бэ — хураангуй, хэмжээний задаргаатай. */
  roundOrders: (roundId: string) =>
    request<RoundOrders>(`/admin/rounds/${roundId}/orders`, adminAuth).then((r) => r.data),

  deleteRound: (roundId: string) =>
    request<{ id: string }>(`/admin/rounds/${roundId}`, {
      ...adminAuth,
      method: "DELETE",
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

  ads: () => request<AdminAd[]>("/admin/ads", adminAuth).then((r) => r.data),

  createAd: (body: {
    title?: string;
    imageUrl: string;
    linkUrl?: string | null;
    isActive?: boolean;
    sortOrder?: number;
  }) =>
    request<AdminAd>("/admin/ads", { ...adminAuth, method: "POST", body }).then(
      (r) => r.data,
    ),

  updateAd: (
    id: string,
    body: Partial<{
      title: string;
      imageUrl: string;
      linkUrl: string | null;
      isActive: boolean;
      sortOrder: number;
    }>,
  ) =>
    request<AdminAd>(`/admin/ads/${id}`, {
      ...adminAuth,
      method: "PATCH",
      body,
    }).then((r) => r.data),

  deleteAd: (id: string) =>
    request<{ id: string }>(`/admin/ads/${id}`, {
      ...adminAuth,
      method: "DELETE",
    }).then((r) => r.data),

  presignAdImage: (id: string, contentType: string) =>
    request<{
      uploadUrl: string;
      publicUrl: string;
      headers: Record<string, string>;
    }>(`/admin/ads/${id}/image`, {
      ...adminAuth,
      method: "POST",
      body: { contentType },
    }).then((r) => r.data),

  orders: (query?: Query) =>
    request<AdminOrderRow[]>("/admin/orders", { ...adminAuth, query }),

  /** Шүүлт/сонголтын дагуу дэлгэрэнгүй захиалга (Excel, хэвлэх). */
  exportOrders: (query?: Query) =>
    request<AdminOrderDetail[]>("/admin/orders/export", { ...adminAuth, query }),

  order: (id: string) =>
    request<AdminOrderDetail>(`/admin/orders/${id}`, adminAuth).then((r) => r.data),

  createOrder: (body: {
    customerId?: string;
    email?: string;
    phone?: string;
    name?: string;
    note?: string;
    status?: "NEW" | "CONFIRMED";
    markPaid?: boolean;
    items: {
      productId: string;
      qty: number;
      selections?: Record<string, string>;
      size?: string;
      color?: string;
    }[];
  }) =>
    request<AdminOrderDetail>("/admin/orders", {
      ...adminAuth,
      method: "POST",
      body,
    }).then((r) => r.data),

  setOrderStatus: (id: string, status: string, reason?: string, force?: boolean) =>
    request<AdminOrderDetail>(`/admin/orders/${id}/status`, {
      ...adminAuth,
      method: "PATCH",
      body: { status, reason, force },
    }).then((r) => r.data),

  /** Төлвийг нэг алхам буцаана (санамсаргүй урагшлуулсан үед). */
  revertOrderStatus: (id: string, reason?: string) =>
    request<AdminOrderDetail>(`/admin/orders/${id}/status/revert`, {
      ...adminAuth,
      method: "POST",
      body: reason ? { reason } : {},
    }).then((r) => r.data),

  /** Олон захиалгын төлөв нэг хүсэлтээр. Алдаатайг тусад нь буцаана. */
  bulkOrderStatus: (ids: string[], status: string, force?: boolean) =>
    request<{
      requested: number;
      succeeded: number;
      failed: { id: string; code?: string; message: string }[];
      status: string;
    }>("/admin/orders/bulk-status", {
      ...adminAuth,
      method: "POST",
      body: { ids, status, force },
    }).then((r) => r.data),

  // --- Төлбөрийн дэвтэр ---

  ledger: (orderId: string) =>
    request<PaymentLedger>(`/admin/orders/${orderId}/payments`, adminAuth).then(
      (r) => r.data,
    ),

  recordPayment: (
    orderId: string,
    body: { amount: number; method?: PaymentMethod; reference?: string; note?: string },
  ) =>
    request<{ payment: Payment; totals: OrderTotals }>(
      `/admin/orders/${orderId}/payments`,
      { ...adminAuth, method: "POST", body },
    ).then((r) => r.data),

  recordRefund: (
    orderId: string,
    body: { amount: number; method?: PaymentMethod; reference?: string; note?: string },
  ) =>
    request<{ payment: Payment; totals: OrderTotals }>(
      `/admin/orders/${orderId}/payments/refunds`,
      { ...adminAuth, method: "POST", body },
    ).then((r) => r.data),

  cancelOrderItem: (
    orderId: string,
    itemId: string,
    body?: { reason?: string; refund?: boolean },
  ) =>
    request<{ totals: OrderTotals; refunded: number; orderCancelled: boolean }>(
      `/admin/orders/${orderId}/payments/items/${itemId}/cancel`,
      { ...adminAuth, method: "POST", body: body ?? {} },
    ).then((r) => r.data),

  batches: (query?: Query) =>
    request<AdminBatch[]>("/admin/batches", { ...adminAuth, query }),

  batch: (id: string) =>
    request<AdminBatchDetail>(`/admin/batches/${id}`, adminAuth).then((r) => r.data),

  createBatch: (body: {
    name: string;
    deadline?: string | null;
    orderIds?: string[];
    weightKg?: number;
    etaFrom?: string;
    etaTo?: string;
  }) =>
    request<AdminBatch>("/admin/batches", { ...adminAuth, method: "POST", body }).then(
      (r) => r.data,
    ),

  updateBatch: (
    id: string,
    body: Partial<{
      name: string;
      deadline: string | null;
      weightKg: number | null;
      etaFrom: string | null;
      etaTo: string | null;
    }>,
  ) =>
    request<BatchSummary>(`/admin/batches/${id}`, {
      ...adminAuth,
      method: "PATCH",
      body,
    }).then((r) => r.data),

  advanceBatch: (id: string) =>
    request<AdminBatch & { ordersMoved: number }>(`/admin/batches/${id}/advance`, {
      ...adminAuth,
      method: "POST",
    }).then((r) => r.data),

  revertBatchStage: (id: string) =>
    request<AdminBatch & { ordersMoved: number }>(`/admin/batches/${id}/stage/revert`, {
      ...adminAuth,
      method: "POST",
    }).then((r) => r.data),

  updateBatchOrders: (id: string, body: { add?: string[]; remove?: string[] }) =>
    request<{ added: number; removed: number }>(`/admin/batches/${id}/orders`, {
      ...adminAuth,
      method: "POST",
      body,
    }).then((r) => r.data),

  omitBatchOrder: (batchId: string, orderId: string) =>
    request<{ omitted: boolean }>(`/admin/batches/${batchId}/orders/${orderId}/omit`, {
      ...adminAuth,
      method: "POST",
    }).then((r) => r.data),

  reinstateBatchOrder: (batchId: string, orderId: string) =>
    request<{ reinstated: boolean }>(`/admin/batches/${batchId}/orders/${orderId}/reinstate`, {
      ...adminAuth,
      method: "POST",
    }).then((r) => r.data),

  /** Багцад бараа нэмнэ — шинэ тойрог, эсвэл `roundId`-аар одоогийн урьдчилсан гаргалт. */
  addBatchProduct: (
    batchId: string,
    body: {
      productId?: string;
      roundId?: string;
      costPrice?: number;
      sellPrice?: number;
      closeAt?: string;
      leadMinDays?: number;
      leadMaxDays?: number;
      note?: string;
      status?: "ACTIVE" | "DRAFT" | "HIDDEN";
    },
  ) =>
    request<BatchProduct>(`/admin/batches/${batchId}/products`, {
      ...adminAuth,
      method: "POST",
      body,
    }).then((r) => r.data),

  /** Багцаас бараа салгах — захиалгатай бол зөвхөн unlink. */
  removeBatchProduct: (batchId: string, roundId: string) =>
    request<{ removed: boolean; unlinked?: boolean }>(
      `/admin/batches/${batchId}/products/${roundId}`,
      {
        ...adminAuth,
        method: "DELETE",
      },
    ).then((r) => r.data),

  handoverLookup: (code: string) =>
    request<
      AdminOrderDetail & {
        canHandOver: boolean;
        blockReason: string | null;
        pickableItemIds?: string[];
      }
    >("/admin/handover/lookup", { ...adminAuth, query: { code } }).then((r) => r.data),

  handoverCustomer: (q: string) =>
    request<HandoverCustomer[]>("/admin/handover/customer", {
      ...adminAuth,
      query: { q },
    }).then((r) => r.data),

  handoverPartial: (body: {
    itemIds: string[];
    collectedAmount?: number;
    note?: string;
  }) =>
    request<{
      itemCount: number;
      orderIds: string[];
      completedOrderIds: string[];
    }>("/admin/handover/partial", {
      ...adminAuth,
      method: "POST",
      body,
    }).then((r) => r.data),

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

  createCustomer: (body: {
    email: string;
    name?: string | null;
    phone?: string | null;
    password?: string;
    emailVerified?: boolean;
  }) =>
    request<AdminCustomer>("/admin/customers", {
      ...adminAuth,
      method: "POST",
      body,
    }).then((r) => r.data),

  updateCustomer: (
    id: string,
    body: Partial<{
      email: string;
      name: string | null;
      phone: string | null;
      password: string;
      emailVerified: boolean;
      district: string | null;
      khoroo: string | null;
      addressText: string | null;
      notifyPayment: boolean;
      notifyArrival: boolean;
      notifyPromo: boolean;
    }>,
  ) =>
    request<AdminCustomer>(`/admin/customers/${id}`, {
      ...adminAuth,
      method: "PATCH",
      body,
    }).then((r) => r.data),

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

  // --- Архив: устгасан бичлэгийг ч агуулсан бүрэн түүх ---

  archiveCalendar: (year: number, month: number) =>
    request<ArchiveCalendar>("/admin/archive/calendar", {
      ...adminAuth,
      query: { year, month },
    }).then((r) => r.data),

  archiveDay: (date: string) =>
    request<ArchiveDay>("/admin/archive/day", { ...adminAuth, query: { date } }).then(
      (r) => r.data,
    ),

  archiveProduct: (productId: string) =>
    request<ArchiveProduct>(`/admin/archive/product/${productId}`, adminAuth).then(
      (r) => r.data,
    ),

  archiveCustomer: (customerId: string) =>
    request<ArchiveCustomer>(`/admin/archive/customer/${customerId}`, adminAuth).then(
      (r) => r.data,
    ),

  archiveSearch: (q: string) =>
    request<ArchiveSearch>("/admin/archive/search", { ...adminAuth, query: { q } }).then(
      (r) => r.data,
    ),

  settings: () =>
    request<Settings>("/admin/settings", adminAuth).then((r) => r.data),

  updateSettings: (body: Partial<Settings>) =>
    request<Settings>("/admin/settings", {
      ...adminAuth,
      method: "PATCH",
      body,
    }).then((r) => r.data),

  /** Өөрчлөлтийн бүртгэл. Тодорхой бичлэгээр шүүж болно. */
  audit: (query?: { entity?: string; entityId?: string; limit?: number }) =>
    request<AuditLog[]>("/admin/settings/audit", { ...adminAuth, query }).then(
      (r) => r.data,
    ),
};
