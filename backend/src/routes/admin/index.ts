import { Router } from 'express';
import { requireStaff } from '../../middleware/auth.js';
import { adminAdsRouter } from './ads.js';
import { adminAuthRouter } from './auth.js';
import { adminBatchesRouter } from './batches.js';
import { adminCategoriesRouter } from './categories.js';
import { adminCustomersRouter } from './customers.js';
import { adminDeliveriesRouter } from './deliveries.js';
import { adminHandoverRouter } from './handover.js';
import { adminOrdersRouter } from './orders.js';
import { adminProductsRouter } from './products.js';
import { adminReportsRouter } from './reports.js';
import { adminRoundsRouter } from './rounds.js';
import { adminSettingsRouter } from './settings.js';

export const adminRouter = Router();

// Нэвтрэх нь нээлттэй, бусад бүх зам JWT шаардана.
adminRouter.use('/auth', adminAuthRouter);
adminRouter.use(requireStaff);

adminRouter.use('/ads', adminAdsRouter);
adminRouter.use('/products', adminProductsRouter);
adminRouter.use('/rounds', adminRoundsRouter);
adminRouter.use('/categories', adminCategoriesRouter);
adminRouter.use('/orders', adminOrdersRouter);
adminRouter.use('/batches', adminBatchesRouter);
adminRouter.use('/handover', adminHandoverRouter);
adminRouter.use('/deliveries', adminDeliveriesRouter);
adminRouter.use('/customers', adminCustomersRouter);
adminRouter.use('/reports', adminReportsRouter);
adminRouter.use('/settings', adminSettingsRouter);
