# Өгөгдөл ба API

Schema: `backend/prisma/schema.prisma`. Route: `backend/src/routes`. Үндсэн prefix `/api`.

| Бүлэг | Гол өгөгдөл |
|---|---|
| Каталог | Category, Product, ProductRound, ProductVariant, SizeChartRow, SKU/сонголтын үнэ |
| Хэрэглэгч/эрх | Customer, AdminUser, AdminLoginPhone, PhoneOtp, сессийн tokenVersion |
| Захиалга | Order, OrderItem, QpayInvoice, Payment |
| Ачаа/олголт | Batch, BatchArrivalNote, ирсэн/олгосон qty, олголтын баримт |
| Лизинг | ItgelSettlement, ItgelSettlementPayment, allocation, ready-transfer |
| Гаднын үйлчилгээ | SmsDispatch, MoneyException, AuditLog, Setting |

Public: `/products`, `/categories`, `/home`, `/store`, `/auth`, `/me`, `/orders`, `/qpay`.
Admin: `/admin/orders`, `/products`, `/rounds`, `/batches`, `/handover`, `/deliveries`,
`/returns`, `/customers`, `/reports`, `/settings`, `/staff`, `/leasing-settlements`, `/work`.
Leasing: `/leasing/orders`, `/customers`, `/products`, `/finance`, `/sms`, `/settings`, `/work`.

Мөнгөний бичилт, нөөц, олголтод transaction/lock хэрэглэнэ. QPay callback idempotent.
Payment ба Itgel allocation дүн, захиалгын кэш, үлдэгдлийг хооронд нь тулган шалгана.
API бүрийн бодит эрх, input, return type-ийн эх сурвалж нь код ба тест; энэ тэмдэглэл тойм.

Бүрэн статик лавлах: [[13 API лавлах]], [[14 Өгөгдлийн лавлах]].
`scripts/sync-obsidian.mjs` ажиллуулахад кодын бүтэцтэй хамт шинэчлэгдэнэ.
