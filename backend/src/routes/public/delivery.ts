import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, query, validate } from '../../middleware/validate.js';
import { listSlots } from '../../services/delivery.js';
import { districtList, getSettings } from '../../services/settings.js';

export const publicDeliveryRouter = Router();

const slotsQuery = z.object({ days: z.coerce.number().int().min(1).max(30).default(14) });

/** GET /api/delivery/slots — өдөр тус бүрийн сул хэмжээ, дүүргүүд. */
publicDeliveryRouter.get(
  '/slots',
  validate({ query: slotsQuery }),
  asyncHandler(async (req, res) => {
    const { days } = query<z.infer<typeof slotsQuery>>(req);
    const settings = await getSettings();
    const slots = await listSlots(settings, days);

    res.json({ data: { slots, districts: districtList(settings) } });
  }),
);
