-- VariantKind enum → free string labels (Хэмжээ / Өнгө).
ALTER TABLE "ProductVariant" ALTER COLUMN "kind" TYPE TEXT USING (
  CASE "kind"::text
    WHEN 'SIZE' THEN 'Хэмжээ'
    WHEN 'COLOR' THEN 'Өнгө'
    ELSE "kind"::text
  END
);

DROP TYPE IF EXISTS "VariantKind";

-- Order item selections JSON; backfill from size/color.
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "selections" JSONB NOT NULL DEFAULT '{}';

UPDATE "OrderItem"
SET "selections" = COALESCE(
  (
    SELECT jsonb_strip_nulls(jsonb_build_object(
      'Хэмжээ', NULLIF("size", ''),
      'Өнгө', NULLIF("color", '')
    ))
  ),
  '{}'::jsonb
)
WHERE "selections" = '{}'::jsonb
  AND ("size" IS NOT NULL OR "color" IS NOT NULL);
