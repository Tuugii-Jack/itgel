# itgel — Backend хийх промпт

Дизайнаас гарган авсан бүрэн техникийн заавар. Доорхийг AI кодлогч (Claude Code, Cursor гэх мэт) руу шууд хуулж өгч болно.

---

## Промпт

Надад `itgel` гэдэг захиалгын дэлгүүрийн **backend** хийж өгөөч. Frontend (хэрэглэгчийн 6 дэлгэц + админ панель) бэлэн, зөвхөн API болон өгөгдлийн сан хэрэгтэй.

### Бизнес модель

Гадаадаас бараа захиалж, багцлан тээвэрлэж, Улаанбаатарт хүлээлгэн өгдөг дэлгүүр. Хоёр төрлийн бараа зэрэг зарна:

- **Захиалгын бараа** — захиалга хаагдах өдөр байна, хаагдсанаас хойш N–M хоногийн дараа гарт очно.
- **Бэлэн бараа** — агуулахад байгаа, маргааш авна.

Төлбөрийг захиалга өгөх үед **100%** төлдөг (хувь нь тохиргооноос өөрчлөгддөг байх). Хэрэглэгч утасны дугаараар бүртгэгддэг, нэвтрэх нь SMS код.

### Технологи

- Node.js + TypeScript, Express эсвэл Fastify
- PostgreSQL + Prisma
- JWT (хэрэглэгч ба админ тусдаа role)
- Зураг: S3-тэй тохирох object storage, presigned upload URL
- SMS: провайдерын adapter interface хийж, dev дээр console mock
- Валид: zod, бүх endpoint дээр
- Тест: гол бизнес логик дээр (огноо бодох, төлөв шилжих, төлбөр)

### Өгөгдлийн сан

**Category**
`id, name, isActive, sortOrder, createdAt`
Бараатай ангилал устгагдахгүй (409 буцаа). `isActive=false` бол хэрэглэгчийн шүүлтүүрт харагдахгүй, харин байгаа бараа хэвээр зарагдана.

**Product**
`id, name, description, categoryId, costPrice, sellPrice, stock, closeAt (nullable), leadMinDays, leadMaxDays, status, images[], createdAt, updatedAt`

- `status`: `ACTIVE | HIDDEN | DRAFT | CLOSED | SOLD_OUT | ARCHIVED`
- `closeAt = null` бол бэлэн бараа.
- **Гарт очих огноо бодолт**: `arriveFrom = closeAt + leadMinDays`, `arriveTo = closeAt + leadMaxDays`. Хадгалахгүй, уншихад бодогдоно.
- `costPrice` (анхны үнэ) хэрэглэгчийн API-д **хэзээ ч буцаахгүй** — зөвхөн админ ба тайлан.
- Ашиг: `sellPrice - costPrice`, хувь: `(sellPrice - costPrice) / sellPrice`.
- Шинэ бараа үүсгэхэд `leadMinDays/leadMaxDays` тохиргооны анхны утгаас (7–14) орно.

**ProductVariant**
`id, productId, kind (SIZE|COLOR), value, sortOrder`
Хэмжээ, өнгө нь чөлөөт текст (админ chip-ээр нэмж хасна).

**SizeChartRow**
`id, productId, size, heightRange, chestCm` — барааны дэлгэрэнгүй дээрх хүснэгт.

**Customer**
`id, phone (unique), name, createdAt`
Утасны дугаараар л бүртгэгдэнэ. Нэр нь захиалга өгөхөд эсвэл дараа нь орно.

**OtpCode**
`id, phone, code (4 орон), expiresAt, usedAt, attempts`
Хугацаа 5 минут, 60 секундэд нэгээс олон удаа илгээхгүй, 5 удаа буруу оруулбал блоклоно.

**Order**
`id, code, customerId, status, subtotal, paidAmount, dueAmount, deliveryFee, batchId (nullable), fulfilment (PICKUP|DELIVERY|null), createdAt`

- `code`: `PH-` + 6 тэмдэгт (том үсэг, тоо), давхардахгүй.
- `status`: `NEW | CONFIRMED | IN_BATCH | IN_TRANSIT | ARRIVED | HANDED_OVER | CANCELLED`
- Шилжих боломжтой чиглэл: NEW→CONFIRMED→IN_BATCH→IN_TRANSIT→ARRIVED→HANDED_OVER. CANCELLED руу HANDED_OVER-с бусад бүх төлвөөс. Буруу шилжилтэд 409.
- `fulfilment` нь бараа **ирсний дараа** хэрэглэгч сонгоно (эхэндээ null).

**OrderItem**
`id, orderId, productId, nameSnapshot, size, color, qty, unitPrice, costPriceSnapshot`
Барааны нэр, үнэ, өртөг захиалга өгөх үеийнхээрээ хөшдөг — дараа үнэ өөрчлөгдөхөд тайлан гажихгүй.

**Batch**
`id, name, closedAt, stage, weightKg, etaFrom, etaTo, createdAt`
`stage` 0–5: `COLLECTING, CLOSED, AT_SUPPLIER, IN_TRANSIT, AT_WAREHOUSE, DONE`.
Багцын шат ахихад дотор байгаа бүх захиалгын төлөв автоматаар дагаж шилжинэ (IN_TRANSIT → захиалга IN_TRANSIT, AT_WAREHOUSE → ARRIVED).

**Delivery**
`id, orderId, scheduledDay, district, khoroo, addressText, fee, courierName, status (PENDING|ASSIGNED|DELIVERED)`

**Setting** (нэг мөр, key-value эсвэл singleton)
`storeName, phone, address, workHours, facebookUrl, depositPercent, defaultLeadMinDays, defaultLeadMaxDays, smsOnArrival, autoCloseOnDeadline`

**AuditLog**
`id, actor, action, entity, entityId, before, after, createdAt` — бараа, захиалга, тохиргооны бүх өөрчлөлт.

### Хэрэглэгчийн API (`/api`)

```
GET    /categories                    isActive=true зөвхөн
GET    /products?category=&type=order|ready&q=&page=
GET    /products/:id                  variants, sizeChart, arriveFrom/To оруулаад
POST   /auth/otp                      { phone } → код илгээнэ
POST   /auth/verify                   { phone, code } → JWT
POST   /orders                        { items[], phone } → code, төлөх дүн
GET    /orders/:code                  публик хяналт, timeline-тай
POST   /orders/:code/fulfilment       { type, district, khoroo, address, day }
GET    /delivery/slots                өдөр тус бүрийн сул хэмжээ
GET    /store                         хаяг, цаг, утас, Facebook
```

`GET /orders/:code` нь дизайн дээрх timeline-г бүтнээр буцаана: захиалга өгсөн, баталгаажсан, нийлүүлэгч рүү явсан, зам дээр, агуулахад ирсэн, хүлээлгэн өгсөн — тус бүр `at` эсвэл `estimatedAt`-тай.

### Админ API (`/api/admin`, JWT + ADMIN role)

```
GET    /products?status=&q=&page=
POST   /products
PATCH  /products/:id
DELETE /products/:id
POST   /products/bulk-status         { ids[], status }
POST   /products/bulk-delete
POST   /products/:id/images          presigned URL

GET    /categories
POST   /categories
PATCH  /categories/:id               name, isActive
DELETE /categories/:id               бараатай бол 409

GET    /orders?status=&q=&batch=&page=
GET    /orders/:id
PATCH  /orders/:id/status

GET    /batches
POST   /batches                      хаагдсан захиалгуудаас
POST   /batches/:id/advance          дараагийн шат
POST   /batches/:id/orders           захиалга нэмэх, хасах

GET    /handover/lookup?code=        QR эсвэл кодоор
POST   /handover/:orderId/complete

GET    /deliveries?day=
PATCH  /deliveries/:id               жолооч, төлөв

GET    /customers?q=&page=           захиалгын тоо, нийт зарцуулалт, сүүлд
GET    /customers/:id

GET    /reports/revenue?period=3m|6m|1y   сар тус бүрийн борлуулалт, ашиг
GET    /reports/products                  ашгийн хувиар эрэмбэлсэн

GET    /settings
PATCH  /settings
```

### Автомат үйлдэл (cron)

1. **Захиалга хаах** — `autoCloseOnDeadline` асаалттай бол `closeAt` хүрсэн барааг `CLOSED` болгоно (өдөрт нэг).
2. **SMS мэдэгдэл** — `smsOnArrival` асаалттай бол захиалга `ARRIVED` болмогц захиалагчийн дугаар руу код, авах заавартай мессеж.
3. **Үлдэгдэл сануулга** — гарт очих огноо 2 хоногийн дараа бол хүлээлгэн өгөөгүй захиалгуудыг админд тайлагнана.

### Тооцооллын дүрэм

- Захиалгын дүн: `Σ(unitPrice × qty)`.
- Одоо төлөх: `дүн × depositPercent / 100`. 100% үед `dueAmount = 0`.
- Хүргэлтийн хураамж: дүүргээр 5,000–8,000₮, тохиргооны хүснэгтээс.
- Тайлангийн ашиг: `Σ((unitPrice − costPriceSnapshot) × qty)`, зөвхөн `HANDED_OVER` захиалгууд.
- Бүх дүн бүхэл тоо (төгрөг), float хэрэглэхгүй.

### Заавал биелүүлэх зүйлс

- Бүх огноо ISO 8601, `Asia/Ulaanbaatar` (UTC+8) цагийн бүсэд бодогдоно.
- Мессеж, төлөв, ангилалын нэр монголоор; enum нь англи хэвээр.
- Устгах нь soft delete (`deletedAt`), захиалгын түүх хэзээ ч алдагдахгүй.
- Rate limit: OTP endpoint дугаар тус бүрээр, захиалга үүсгэх IP-ээр.
- Seed script: 6 ангилал, 10 бараа, 9 захиалга, 3 багц, 7 хэрэглэгч, 6 сарын борлуулалт.
- OpenAPI spec гарга.

Эхлээд Prisma schema, дараа нь endpoint-уудыг хэсэгчлэн хий. Асуулт байвал кодлохоосоо өмнө асуу.
