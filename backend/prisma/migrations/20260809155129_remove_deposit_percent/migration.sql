-- Төлбөр үргэлж 100% тул урьдчилгааны хувь гэсэн ойлголт хасагдав.
-- `prepayAmount` нь subtotal-тай тэнцүү байсан, `depositPercent` нь 100 байсан
-- тул мэдээлэл алдагдахгүй.

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "prepayAmount";

-- AlterTable
ALTER TABLE "Setting" DROP COLUMN "depositPercent";
