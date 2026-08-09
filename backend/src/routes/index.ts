import { Router } from 'express';
import { adminRouter } from './admin/index.js';
import { publicAuthRouter } from './public/auth.js';
import { publicCategoriesRouter } from './public/categories.js';
import { publicDeliveryRouter } from './public/delivery.js';
import { publicMeRouter } from './public/me.js';
import { publicOrdersRouter } from './public/orders.js';
import { publicProductsRouter } from './public/products.js';
import { publicStoreRouter } from './public/store.js';

export const apiRouter = Router();

apiRouter.use('/categories', publicCategoriesRouter);
apiRouter.use('/products', publicProductsRouter);
apiRouter.use('/auth', publicAuthRouter);
apiRouter.use('/me', publicMeRouter);
apiRouter.use('/orders', publicOrdersRouter);
apiRouter.use('/delivery', publicDeliveryRouter);
apiRouter.use('/store', publicStoreRouter);

apiRouter.use('/admin', adminRouter);
