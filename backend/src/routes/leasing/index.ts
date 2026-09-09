import { Router } from 'express';
import { requireLeasing } from '../../middleware/auth.js';
import { leasingCustomersRouter } from './customers.js';
import { leasingOrdersRouter } from './orders.js';
import { leasingSettingsRouter } from './settings.js';

export const leasingRouter = Router();

leasingRouter.use(requireLeasing);
leasingRouter.use('/orders', leasingOrdersRouter);
leasingRouter.use('/customers', leasingCustomersRouter);
leasingRouter.use('/settings', leasingSettingsRouter);
