-- Shop API Prisma-аар (хүснэгтийн эзэн) уншина — RLS-ийг тойрно.
-- PostgREST anon/authenticated түлхүүрээр мөр уншихгүй.
-- Policy нэмэхгүй: default deny. FORCE ROW LEVEL SECURITY тавихгүй.

ALTER TABLE IF EXISTS "RoundCargoFee" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "LeasingUser" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "PhoneOtp" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "ReadyStockTransfer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "ReadyStockTransferLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "CheckoutIdempotency" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "SmsDispatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "QpayInvoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "ItgelSettlement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "ItgelSettlementPayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "ItgelSettlementPaymentLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "MoneyException" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "AdminLoginPhone" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END $$;
