import { Router } from 'express';
import { requireAdmin, requireAdminWrites, requireStaff } from '../../middleware/auth.js';
import { adminAdsRouter } from './ads.js';
import { adminArchiveRouter } from './archive.js';
import { adminAuthRouter } from './auth.js';
import { adminBatchesRouter } from './batches.js';
import { adminCategoriesRouter } from './categories.js';
import { adminCustomersRouter } from './customers.js';
import { adminDeliveriesRouter } from './deliveries.js';
import { adminHandoverRouter } from './handover.js';
import { adminOrdersRouter } from './orders.js';
import { adminProductsRouter } from './products.js';
import { adminReportsRouter } from './reports.js';
import { adminReturnsRouter } from './returns.js';
import { adminRoundsRouter } from './rounds.js';
import { adminSettingsRouter } from './settings.js';
import { adminQpayRouter } from './qpay.js';
import { adminStaffRouter } from './staff.js';

export const adminRouter = Router();

// Нэвтрэх нь нээлттэй, бусад бүх зам JWT шаардана.
adminRouter.use('/auth', adminAuthRouter);
adminRouter.use(requireStaff);

adminRouter.use('/ads', requireAdmin, adminAdsRouter);
adminRouter.use('/archive', requireAdmin, adminArchiveRouter);
adminRouter.use('/products', requireAdmin, adminProductsRouter);
adminRouter.use('/rounds', requireAdminWrites, adminRoundsRouter);
adminRouter.use('/categories', requireAdmin, adminCategoriesRouter);
adminRouter.use('/orders', requireAdminWrites, adminOrdersRouter);
adminRouter.use('/batches', requireAdminWrites, adminBatchesRouter);
adminRouter.use('/handover', adminHandoverRouter);
adminRouter.use('/deliveries', requireAdminWrites, adminDeliveriesRouter);
adminRouter.use('/returns', requireAdminWrites, adminReturnsRouter);
adminRouter.use('/customers', requireAdminWrites, adminCustomersRouter);
adminRouter.use('/reports', requireAdminWrites, adminReportsRouter);
adminRouter.use('/settings', requireAdmin, adminSettingsRouter);
adminRouter.use('/qpay', requireAdmin, adminQpayRouter);
adminRouter.use('/staff', requireAdmin, adminStaffRouter);
