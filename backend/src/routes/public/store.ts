import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { qpayPublicStatus } from '../../services/qpay.js';
import { districtList, districtNames, getSettingsCached } from '../../services/settings.js';

export const publicStoreRouter = Router();

/** GET /api/store — хаяг, цаг, утас, Facebook. Төлбөр зөвхөн QPay. */
publicStoreRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const settings = await getSettingsCached();
    const qpay = qpayPublicStatus();
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
    res.json({
      data: {
        storeName: settings.storeName,
        phone: settings.phone,
        address: settings.address,
        workHours: settings.workHours,
        facebookUrl: settings.facebookUrl,
        deliveryDistricts: districtNames(settings),
        deliveryFees: districtList(settings),
        // Хэрэглэгч зөвхөн QPay-ээр төлнө — дэлгүүрийн данс нийтэд гаргахгүй.
        bank: null,
        /** QPay сонголт — enabled=flag, ready=credential бэлэн. */
        qpay,
        /** Мөнгө ороогүй захиалга хэдэн цагийн дараа цуцлагдах. 0 = цуцлахгүй. */
        unpaidCancelHours: settings.unpaidCancelHours,
        /** Агуулахад ирснээс хойш үнэгүй хадгалах хоног. */
        storageFreeDays: settings.storageFreeDays,
        /** Үнэгүй хоногоос хэтэрсэн хоног бүрийн хураамж ₮. 0 = унтраана. */
        storageFeePerDay: settings.storageFeePerDay,
      },
    });
  }),
);