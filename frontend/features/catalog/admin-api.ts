import { adminAuth, request, uploadBinary, type Query } from "@/lib/api/client";
import type { AdminAd, AdminCategory, AdminProduct, AdminRound, RoundOrders } from "@/types";

export const adminCatalogApi = {
  products: (query?: Query) =>
    request<AdminProduct[]>("/admin/products", { ...adminAuth, query }),

  product: (id: string) =>
    request<AdminProduct>(`/admin/products/${id}`, adminAuth).then(
      (r) => r.data,
    ),

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

  /** Шинэ гаргалт. Үнийг өгөхгүй бол сүүлийн гаргалтынхыг авна. */
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
      optionPrices?: {
        kind?: string;
        value?: string;
        selections?: Record<string, string>;
        sellPrice: number;
        costPrice?: number;
      }[];
      skuStocks?: {
        selections: Record<string, string>;
        stock: number;
      }[];
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
      optionPrices: {
        kind?: string;
        value?: string;
        selections?: Record<string, string>;
        sellPrice: number;
        costPrice?: number;
      }[];
      skuStocks?: {
        selections: Record<string, string>;
        stock: number;
      }[];
    }>,
  ) =>
    request<AdminRound>(`/admin/rounds/${roundId}`, {
      ...adminAuth,
      method: "PATCH",
      body,
    }).then((r) => r.data),

  /** Энэ гаргалтыг хэн хэн авсан бэ — хураангуй, хэмжээний задаргаатай. */
  roundOrders: (roundId: string) =>
    request<RoundOrders>(`/admin/rounds/${roundId}/orders`, adminAuth).then(
      (r) => r.data,
    ),

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

  uploadImage: (id: string, file: Blob) =>
    uploadBinary<{ publicUrl: string; key: string }>(
      `/admin/products/${id}/images/upload`,
      file,
    ).then((r) => r.data),

  saveImages: (id: string, images: string[]) =>
    request<{ images: string[] }>(`/admin/products/${id}/images`, {
      ...adminAuth,
      method: "PATCH",
      body: { images },
    }).then((r) => r.data),

  categories: () =>
    request<AdminCategory[]>("/admin/categories", adminAuth).then(
      (r) => r.data,
    ),

  createCategory: (body: {
    name: string;
    isActive?: boolean;
    sortOrder?: number;
  }) =>
    request<AdminCategory>("/admin/categories", {
      ...adminAuth,
      method: "POST",
      body,
    }).then((r) => r.data),

  updateCategory: (
    id: string,
    body: Partial<{ name: string; isActive: boolean; sortOrder: number }>,
  ) =>
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

  uploadAdImage: (id: string, file: Blob) =>
    uploadBinary<{ publicUrl: string; key: string }>(
      `/admin/ads/${id}/image/upload`,
      file,
    ).then((r) => r.data),
};
