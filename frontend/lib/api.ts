import { shopAuthApi } from "@/features/auth/api";
import { adminAuthApi } from "@/features/auth/admin-api";
import { shopCatalogApi } from "@/features/catalog/api";
import { adminCatalogApi } from "@/features/catalog/admin-api";
import { shopCheckoutApi } from "@/features/checkout/api";
import { shopOrdersApi } from "@/features/orders/shop-api";
import { adminOrdersApi } from "@/features/orders/admin-api";
import { shopProfileApi } from "@/features/profile/api";
import { adminPaymentsApi } from "@/features/payments/admin-api";
import { adminBatchesApi } from "@/features/batches/api";
import { adminHandoverApi } from "@/features/handover/api";
import { adminDeliveriesApi } from "@/features/deliveries/api";
import { adminReturnsApi } from "@/features/returns/api";
import { adminReportsApi } from "@/features/reports/api";
import { leasingApi as leasingPortalApi } from "@/features/leasing/api";

export {
  API_BASE,
  ADMIN_SESSION_COOKIE,
  ApiError,
  TOKEN_KEYS,
  adminAuth,
  isAuthError,
  readToken,
  request,
  uploadBinary,
  writeToken,
} from "./api/client";
export type { Query, RequestOptions, Envelope } from "./api/client";

export const api = {
  ...shopCatalogApi,
  ...shopCheckoutApi,
  ...shopAuthApi,
  ...shopOrdersApi,
  ...shopProfileApi,
};

export const adminApi = {
  ...adminAuthApi,
  ...adminReportsApi,
  ...adminCatalogApi,
  ...adminOrdersApi,
  ...adminPaymentsApi,
  ...adminBatchesApi,
  ...adminHandoverApi,
  ...adminDeliveriesApi,
  ...adminReturnsApi,
};

export const leasingApi = leasingPortalApi;
