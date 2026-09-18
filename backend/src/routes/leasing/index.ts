import { Router } from 'express';
import { requireLeasing } from '../../middleware/auth.js';
import { leasingCustomersRouter } from './customers.js';
import { leasingOrdersRouter } from './orders.js';
import { leasingProductsRouter } from './products.js';
import { leasingSettingsRouter } from './settings.js';
import { leasingSmsRouter } from './sms.js';
import { leasingFinanceRouter } from './finance.js';

export const leasingRouter = Router();

leasingRouter.use(requireLeasing);
leasingRouter.use('/products', leasingProductsRouter);
leasingRouter.use('/orders', leasingOrdersRouter);
leasingRouter.use('/customers', leasingCustomersRouter);
leasingRouter.use('/sms', leasingSmsRouter);
leasingRouter.use('/settings', leasingSettingsRouter);
leasingRouter.use('/finance', leasingFinanceRouter);
