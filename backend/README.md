# itgel — backend

Захиалгын дэлгүүрийн API. Node.js + TypeScript + Express + PostgreSQL (Prisma).
Заавар: [`backend-prompt.md`](backend-prompt.md). API лавлах: [`openapi.yaml`](openapi.yaml).

## Эхлүүлэх

```bash
cp .env.example .env          # DATABASE_URL / DIRECT_URL-ээ тавина
npm install
npx prisma migrate deploy     # хүснэгтүүд үүсгэнэ
npm run seed                  # жишиг өгөгдөл
npm run dev                   # http://localhost:4000
```

Өгөгдлийн сан нь **Supabase Postgres** (pooler). Локал дээр ажиллуулах бол
`docker compose up -d` гээд `.env`-ийн локал холболтын мөрүүдийг идэвхжүүлнэ.

Админ: `admin@itgel.mn` / `admin123` (`.env`-ээс солино).

| Команд | Үйлдэл |
| --- | --- |
| `npm run dev` | Хөгжүүлэлтийн сервер (watch) |
| `npm run build` / `npm start` | Production build ба ажиллуулах |
| `npm test` | Бизнес логикийн тест (51 тест) |
| `npm run test:e2e` | Бүтэн урсгалын тест — сервер ажиллаж байх шаардлагатай |
| `npm run typecheck` | TypeScript шалгалт |
| `npm run seed -- --force` | Өгөгдлийг **бүхэлд нь устгаад** шинээр үүсгэнэ |
| `npm run backfill:payments` | Хуучин захиалгуудыг төлбөрийн дэвтэрт буулгана |

## Бүтэц

```
prisma/schema.prisma    Өгөгдлийн сангийн загвар
prisma/seed.ts          6 ангилал, 10 бараа, 7 хэрэглэгч, 3 багц, 9 захиалга, 6 сарын түүх
src/lib/                Цэвэр бизнес логик — огноо, мөнгө, төлөв шилжилт, код үүсгэлт
src/services/           Prisma-тай ажилладаг давхарга — захиалга, хүргэлт, SMS, storage
src/routes/public/      /api — хэрэглэгчийн endpoint-ууд
src/routes/admin/       /api/admin — JWT + ADMIN/STAFF
src/cron/               Автомат ажлууд
tests/                  Vitest — огноо бодох, төлөв шилжих, төлбөр
```

`src/lib` нь өгөгдлийн сангаас хамааралгүй тул тест шууд ажиллана.

## Гол дүрмүүд

**Огноо.** Бүх бодолт `Asia/Ulaanbaatar` (UTC+8). Гарт очих огноо хадгалагдахгүй, уншихад
бодогдоно: `arriveFrom = closeAt + leadMinDays`, `arriveTo = closeAt + leadMaxDays`.
`closeAt = null` бол бэлэн бараа — маргааш авна.

**Мөнгө.** Бүх дүн бүхэл тоо (₮), float хэрэглэхгүй. Тайлангийн ашиг зөвхөн `HANDED_OVER`
захиалгаас, `costPriceSnapshot`-оор бодогдоно. Цуцлагдсан мөр борлуулалт, ашгийн аль алинд
ордоггүй.

**Төлбөрийн дэвтэр.** Мөнгөний цорын ганц эх сурвалж нь `Payment` хүснэгт. Захиалга дээрх
`subtotal / paidAmount / refundedAmount / dueAmount` багана нь зөвхөн хайлтад зориулсан кэш
бөгөөд [`recalcOrderTotals()`](src/services/money.ts) -ээр л шинэчлэгдэнэ.

- **Төлбөр үргэлж 100%** — урьдчилгааны хувь гэсэн ойлголт байхгүй. Захиалга өгөхөд
  барааны дүнг бүтнээр шилжүүлнэ.
- Захиалга үүсэхэд **мөнгө орсонд тооцогдохгүй** — `dueAmount` нь бүтэн дүн хэвээр.
- Админ шилжүүлгийг шалгаад `POST /admin/orders/:id/payments` -ээр бүртгэнэ.
- Бараа бүрэн төлөгдөөгүй бол захиалга `CONFIRMED` болохгүй (**409**). Бэлнээр авсан бол
  `force: true` -ээр давна.
- Буцаалт нь эсрэг мөр — бичилт хэзээ ч устдаггүй. Цэвэр орлогоос хэтэрвэл 409.
- Хүлээлгэн өгөх, хүргэлт дуусахад авсан мөнгө мөн дэвтэрт бичигдэнэ.

`dueAmount = subtotal + deliveryFee − (paidAmount − refundedAmount)`. Сөрөг бол илүү төлсөн —
буцаах шаардлагатай гэсэн үг. Хүргэлтийн хураамж нь бараа ирсний дараа нэмэгддэг тул
баталгаажуулах болзолд ордоггүй (`fullyPaid()` нь зөвхөн `subtotal`-ыг шалгана).

**Өртөг нууц.** `costPrice` хэрэглэгчийн API-д хэзээ ч гарахгүй — `publicProduct()` ба
`adminProduct()` тусдаа serializer.

**Төлөв.** `NEW → CONFIRMED → IN_BATCH → IN_TRANSIT → ARRIVED → HANDED_OVER`, нэг алхмаар.
`CANCELLED` руу `HANDED_OVER`-с бусад бүх төлвөөс. Буруу шилжилтэд **409**.
Багцын шат ахихад дотор байгаа захиалгууд алхам алхмаар дагаж шилжинэ
(`IN_TRANSIT` → захиалга `IN_TRANSIT`, `AT_WAREHOUSE` → `ARRIVED`).

**Устгалт.** Бүх устгалт soft delete (`deletedAt`) — захиалгын түүх алдагдахгүй.
Бараатай ангилал устгагдахгүй (409). Захиалгын мөрийг тусад нь цуцалж болно
(`cancelledAt`) — бэлэн барааны үлдэгдэл буцаж нэмэгдэнэ, бүх мөр цуцлагдвал
захиалга өөрөө `CANCELLED` болно.

**Багц.** Шат ахиулах нь **нэг транзакц** — багц ба доторх бүх захиалга хамт шилжинэ,
дунд нь алдвал юу ч өөрчлөгдөхгүй. Дахин дуудахад аюулгүй: аль хэдийн зорилтод хүрсэн
захиалгыг алгасна ([`advanceBatch()`](src/services/batches.ts)).

**Хүргэлтийн сул зай.** Өдөр тус бүрээр advisory lock авч шалгадаг тул хоёр хэрэглэгч
сүүлийн зайг зэрэг авах боломжгүй.

**Rate limit.** OTP дугаар тус бүрээр (60 сек, цагт 5), захиалга үүсгэх IP-ээр (10 мин / 10).
Санах ойд хадгалагддаг тул cron 15 минут тутам цэвэрлэнэ. Олон instance ажиллуулах бол
Redis рүү шилжүүлнэ — интерфейс нь адил.

## Автомат ажлууд (cron, UB цагаар)

| Хугацаа | Ажил |
| --- | --- |
| Өдөр бүр 00:05 | `closeAt` хүрсэн барааг `CLOSED` (`autoCloseOnDeadline` асаалттай үед) |
| 10 мин тутам | `ARRIVED` болсон захиалгад ирсэн мэдэгдэл (`smsOnArrival`) |
| Өдөр бүр 09:00 | 2+ хоног хүлээлгэн өгөөгүй захиалгын сануулга (audit log + console) |
| 15 мин тутам | Rate limiter-ийн хугацаа дууссан бичлэг цэвэрлэх |

Мэдэгдэл ердийн урсгалд төлөв солигдох үед шууд илгээгддэг; cron нь аюулгүйн тор.
`CRON_ENABLED=false` болгож унтраана.

## Гадаад үйлчилгээ

**SMS** — `SmsProvider` интерфейс (`src/services/sms.ts`). Dev дээр `ConsoleSmsProvider`
(console руу бичнэ), production-д `SMS_PROVIDER=http` + `SMS_API_URL`/`SMS_API_KEY`.
Өөр провайдер холбоход зөвхөн интерфейсийг шинээр хэрэгжүүлнэ.

**Зураг** — presigned PUT URL. `POST /api/admin/products/:id/images` → `uploadUrl` руу файлаа
шууд PUT хийж, дараа нь `PATCH /api/admin/products/:id/images` -ээр `publicUrl`-уудыг бүртгэнэ.
`STORAGE_PROVIDER` нь `auto` (R2 → Supabase → mock), `r2`, `supabase`, `mock`.
Хариултын `provider` талбар аль нь ажилласныг заана.

### Cloudflare R2

R2 бол S3-нийцтэй тул S3 замаар ажиллана. `.env`-д:

```bash
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_REGION=auto                 # R2 дээр заавал "auto"
R2_BUCKET=itgel-test
R2_ACCESS_KEY_ID=              # R2 → Manage API tokens (32 тэмдэгт)
R2_SECRET_ACCESS_KEY=
R2_PUBLIC_BASE_URL=https://pub-<hash>.r2.dev
R2_FORCE_PATH_STYLE=true
```

Түлхүүр орсны дараа `STORAGE_PROVIDER=auto` үед R2 автоматаар сонгогдоно.

### R2 CORS (заавал)

Админ панелиас зураг байршуулахад браузер R2 руу **шууд** PUT хийдэг тул bucket дээр
CORS тохируулаагүй бол preflight `OPTIONS` 403 буцаж, байршуулалт ажиллахгүй.

Гурван зам байна — аль нэгийг нь сонгоно.

**1. Wrangler (Cloudflare-ийн өөрийн CLI).** Нэг удаа нэвтэрсний дараа хамгийн хялбар:

```bash
npx wrangler login          # хөтөч нээгдэж зөвшөөрөл асууна (нэг удаа)
npm run r2:cors             # r2-cors.json-г bucket дээр тавина
npm run r2:cors:list        # шалгах
```

Домэйн нэмэхдээ [`r2-cors.json`](r2-cors.json)-ы `allowed.origins` дотор бичнэ.
`wrangler login`-ы оронд `CLOUDFLARE_API_TOKEN` (Workers R2 Storage: Edit эрхтэй)
орчны хувьсагч ашиглаж болно.

**2. S3-нийцтэй API.** `.env`-ийн R2 түлхүүрээр:

```bash
npx tsx scripts/r2-cors.ts                     # .env-ийн CORS_ORIGIN + localhost
npx tsx scripts/r2-cors.ts https://itgel.mn    # production домэйн нэмэх
npx tsx scripts/r2-cors.ts --show              # одоогийн тохиргоог харах
```

Энэ зам **Admin Read & Write** түвшний R2 токен шаардана. Байршуулалтад хэрэглэдэг
*Object Read & Write* токен bucket-ийн тохиргоо өөрчлөх эрхгүй тул `AccessDenied` буцаана.

**3. Dashboard.** R2 → bucket → **Settings → CORS Policy** дотор (энэ нь S3 хэлбэрийн JSON):

```json
[{ "AllowedOrigins": ["http://localhost:3000"],
   "AllowedMethods": ["PUT", "GET", "HEAD"],
   "AllowedHeaders": ["content-type"],
   "ExposeHeaders": ["ETag"],
   "MaxAgeSeconds": 3600 }]
```

Шалгах — `204` буюу `200` ирвэл болсон:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS \
  "https://<account-id>.r2.cloudflarestorage.com/<bucket>/test.png" \
  -H "Origin: http://localhost:3000" -H "Access-Control-Request-Method: PUT"
```

## Supabase

| Хэсэг | Төлөв |
| --- | --- |
| Postgres | Идэвхтэй — shared pooler (`6543` апп, `5432` migration). |
| Auth (JWKS) | Supabase-ийн access token-ыг `SUPABASE_JWKS_URL`-ээр шалгана. |
| Storage | Ашиглагдахгүй — зураг **Cloudflare R2** дээр. Supabase-ыг сонговол `product-images` bucket автоматаар үүснэ. |

Холболтын мөрөнд нууц үгийн тусгай тэмдэгтийг URL-encode хийнэ (`@` → `%40`).

**Auth.** Манай утас+OTP урсгал үндсэн хэвээр. Supabase token нэмэлт гарц болж ажиллана:
эхлээд өөрийн JWT-г шалгаж, амжилтгүй бол JWKS-ээр Supabase token-ыг шалгана
([supabaseAuth.ts](src/lib/supabaseAuth.ts)).

- Утасны дугаартай token → `CUSTOMER` (Customer мөр байхгүй бол үүснэ).
- `app_metadata.role` нь `admin`/`staff` **бөгөөд** тухайн и-мэйлээр идэвхтэй `AdminUser`
  бүртгэлтэй үед → админ. Бүртгэлгүй бол эрх олгохгүй — зөвхөн Supabase дээр role
  бичсэнээр админ болох боломжгүй.

**Postgres руу шилжих.** Dashboard → Project Settings → Database → Connection string → Prisma
хэсгээс хоёр мөрийг хуулж `.env`-д тавиад:

```bash
npx prisma migrate deploy   # эсвэл шинэ орчинд: npx prisma migrate dev
npm run seed                # (сонголтоор) жишиг өгөгдөл
```

`SUPABASE_SECRET_KEY` нь RLS-ийг тойрдог тул зөвхөн backend дээр, `.env`-д (git-д ордоггүй)
байна. Frontend-д зөвхөн `SUPABASE_PUBLISHABLE_KEY` хэрэглэнэ.

## Нэмэлт тэмдэглэл

Промптод байхгүй ч ажиллахад шаардлагатай тул нэмсэн зүйлс:

- `POST /api/admin/auth/login` ба `AdminUser` хүснэгт — админ JWT авах гарц.
- `GET/PATCH /api/me`, `GET /api/me/orders` — дизайны «07 Профайл» дэлгэцэд шаардлагатай.
  `Customer`-т хадгалсан хаяг (`district`, `khoroo`, `addressText`) ба мэдэгдлийн
  3 тохиргоо (`notifyPayment`, `notifyArrival`, `notifyPromo`) нэмэгдсэн.
- `PATCH /api/admin/products/:id/images`, `PATCH /api/admin/batches/:id` (жин, ETA),
  `GET /api/admin/reports/summary`, `GET /api/admin/settings/audit`.
- `Setting.deliveryFees` (дүүрэг → хураамж) ба `deliveryDailyLimit` — хүргэлтийн
  хураамж, өдрийн багтаамжийг тохиргооноос удирдана.
- `Order`-т timeline-ий огноонууд (`confirmedAt`, `arrivedAt`, …) ба `arrivalNotifiedAt`.
- Бэлэн бараа захиалахад үлдэгдэл хасагдаж, 0 болбол `SOLD_OUT` болно.
- `Payment` дэвтэр, `POST /admin/orders/:id/payments` (төлбөр), `.../refunds` (буцаалт),
  `.../items/:itemId/cancel` (мөр цуцлах), `POST /admin/orders/bulk-status`.

## Үлдсэн цоорхой

- **Төлбөрийн систем холбоогүй** — QPay, банкны интеграц байхгүй, шилжүүлгийг гараар
  шалгаж бүртгэнэ. `Payment.reference` талбар нь гүйлгээний утгыг хадгалахад бэлэн.
- **Хуудаслалт** — API нь `meta.pages` буцаадаг ч frontend хэрэглэдэггүй.
- **`types.ts` гараар зохицуулагддаг** — `openapi.yaml`-аас үүсгэдэг болговол backend-тэй
  салахгүй.
