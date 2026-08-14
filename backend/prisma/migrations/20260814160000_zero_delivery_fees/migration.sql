-- Хүргэлтийн төлбөрийг дэлгүүр авахгүй — хүргэлтийн компани өөрөө авна.
UPDATE "Delivery" SET "fee" = 0 WHERE "fee" <> 0;

UPDATE "Order"
SET
  "dueAmount" = "subtotal" + "storageFee" + "cargoFee" - ("paidAmount" - "refundedAmount"),
  "deliveryFee" = 0
WHERE "deliveryFee" <> 0
   OR "dueAmount" <> ("subtotal" + "storageFee" + "cargoFee" - ("paidAmount" - "refundedAmount"));
