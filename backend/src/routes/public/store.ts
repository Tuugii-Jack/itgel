import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { districtList, getSettings } from '../../services/settings.js';

export const publicStoreRouter = Router();

/** GET /api/store — хаяг, цаг, утас, Facebook. */
publicStoreRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const settings = await getSettings();
    res.json({
      data: {
        storeName: settings.storeName,
        phone: settings.phone,
        address: settings.address,
        workHours: settings.workHours,
        facebookUrl: settings.facebookUrl,
        deliveryFees: districtList(settings),
      },
    });
  }),
);
