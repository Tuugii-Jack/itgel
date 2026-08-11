import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { districtList, getSettings } from '../../services/settings.js';

export const publicStoreRouter = Router();

/** GET /api/store — хаяг, цаг, утас, Facebook, төлбөр хүлээн авах данс. */
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
        // Данс тохируулаагүй бол null — frontend төлбөрийн самбарыг нуух ёстой.
        bank: settings.bankAccountNumber
          ? {
              name: settings.bankName,
              accountNumber: settings.bankAccountNumber,
              accountName: settings.bankAccountName,
              note: settings.paymentNote,
            }
          : null,
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
