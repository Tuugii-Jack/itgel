import { Router } from 'express';
import { adminRouter } from './admin/index.js';
import { publicAdsRouter } from './public/ads.js';
import { publicAuthRouter } from './public/auth.js';
import { publicCategoriesRouter } from './public/categories.js';
import { publicDeliveryRouter } from './public/delivery.js';
import { publicMeRouter } from './public/me.js';
import { publicOrdersRouter } from './public/orders.js';
import { publicProductsRouter } from './public/products.js';
import { publicQpayRouter } from './public/qpay.js';
import { publicStoreRouter } from './public/store.js';

export const apiRouter = Router();

apiRouter.use('/ads', publicAdsRouter);
apiRouter.use('/categories', publicCategoriesRouter);
apiRouter.use('/products', publicProductsRouter);
apiRouter.use('/auth', publicAuthRouter);
apiRouter.use('/me', publicMeRouter);
// QPay callback/invoice — /orders/qpay/callback нийцүүлэхийн тулд orders-оос өмнө.
apiRouter.use('/orders', publicQpayRouter);
apiRouter.use('/orders', publicOrdersRouter);
apiRouter.use('/delivery', publicDeliveryRouter);
apiRouter.use('/store', publicStoreRouter);

apiRouter.use('/admin', adminRouter);
