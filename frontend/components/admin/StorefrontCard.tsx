"use client";

import Link from "next/link";
import { ProductImage } from "@/components/ProductImage";
import { ShopPrice } from "@/components/ShopPrice";
import {
  PRODUCT_STATUS_LABEL,
  PRODUCT_STATUS_TONE,
} from "@/components/admin/shared";
import { Badge, Button, Divider } from "@/components/ui";
import { arrivalLabel, countdown } from "@/lib/format";
import { priceLabel } from "@/lib/options";
import type { AdminProduct, AdminRound, ProductStatus } from "@/lib/types";

/** Дэлгүүрт харагдах нэгж — тойрог, эцэг бараагаа дагуулсан. */
export interface ShelfItem {
  round: AdminRound;
  product: AdminProduct;
  /** Энэ бараанд идэвхтэй тойрог байгаа эсэх — хуучныг нуухад хэрэгтэй. */
  hasActiveRound: boolean;
}

/** Хэрэглэгчид үнэхээр харагддаг төлвүүд. */
const PUBLIC: ProductStatus[] = ["ACTIVE", "CLOSED", "SOLD_OUT"];

/**
 * Дэлгүүрийн карт — хэрэглэгчийн харагдах байдлыг давтана,
 * сагсны оронд админы хурдан үйлдлүүдтэй.
 */
export function StorefrontCard({
  item,
  busy,
  onToggle,
  onEditRound,
  onEditProduct,
  onOpenBuyers,
}: {
  item: ShelfItem;
  busy: boolean;
  onToggle: () => void;
  onEditRound: () => void;
  onEditProduct: () => void;
  onOpenBuyers: () => void;
}) {
  const { round, product } = item;
  const isOrder = round.type === "order";
  const soldOut = round.status === "SOLD_OUT" || (!isOrder && round.stock <= 0);
  const closed = round.status === "CLOSED";
  const live = PUBLIC.includes(round.status);
  /** Хугацаа нь дууссан — дахин нээхийн оронд шинэ багцад гаргах ёстой. */
  const expired = round.status === "CLOSED" || round.status === "SOLD_OUT";

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-[12px] border bg-bg
        ${live ? "border-line" : "border-dashed border-muted"}`}
    >
      <div className="relative aspect-square border-b border-line bg-surface">
        <ProductImage
          src={product.images[0]}
          alt={product.name}
          className={`h-full w-full ${live ? "" : "opacity-50"}`}
        />

        {!live && (
          <div className="absolute inset-x-2 top-2 rounded-[6px] bg-ink/85 px-2 py-1 text-center text-[12px] text-white">
            Хэрэглэгчид харагдахгүй
          </div>
        )}

        {isOrder && round.closeAt && round.status === "ACTIVE" && (
          <div className="absolute inset-x-2 bottom-2 flex h-[26px] items-center justify-center rounded-[6px] border border-line bg-bg">
            <span className="tnum text-[12px] text-warn">{countdown(round.closeAt)}</span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={PRODUCT_STATUS_TONE[round.status]}>
            {PRODUCT_STATUS_LABEL[round.status]}
          </Badge>
          {product.roundCount > 1 && (
            <Badge tone="info">#{round.roundNo} гаргалт</Badge>
          )}
          {round.batch && (
            <Badge tone="neutral">{round.batch.name}</Badge>
          )}
        </div>

        <div className="clamp-2 text-[15px] leading-[1.4] text-ink">{product.name}</div>

        <div className="flex items-baseline gap-2">
          <span className="tnum text-[18px] font-medium">
            <ShopPrice noteClassName="text-[15px] font-medium text-ink-2">
              {priceLabel(round.price, round.priceMax)}
            </ShopPrice>
          </span>
        </div>

        <Divider className="my-0.5" />

        <div className="flex flex-col gap-1.5">
          <Fact
            label="Гарт очих"
            value={arrivalLabel(round)}
            tone={closed ? "danger" : "neutral"}
          />
          {isOrder ? (
            <Fact
              label="Захиалга"
              value={`${round.orderedQty} ш · ${round.customerCount} хүн`}
            />
          ) : (
            <Fact
              label="Үлдэгдэл"
              value={soldOut ? "Дууссан" : `${round.stock} ширхэг`}
              tone={soldOut ? "danger" : "ok"}
            />
          )}
        </div>

        <button
          type="button"
          onClick={onOpenBuyers}
          disabled={round.customerCount === 0}
          className={`mt-1 rounded-[8px] border border-line px-2.5 py-2 text-left text-[13px]
            ${round.customerCount > 0 ? "cursor-pointer bg-surface hover:bg-surface-2" : "bg-bg text-muted"}`}
        >
          {round.customerCount > 0 ? (
            <>
              <span className="tnum font-medium">{round.customerCount}</span> хүн авсан ·{" "}
              <span className="tnum">{round.orderedQty} ш</span>
            </>
          ) : (
            "Захиалга алга"
          )}
        </button>

        <div className="mt-auto flex flex-col gap-1.5 pt-2">
          {expired ? (
            <Link
              href="/admin/batches"
              className="inline-flex h-11 w-full items-center justify-center rounded-[8px] bg-ink text-[14px] text-white no-underline"
            >
              Багцад дахин гаргах
            </Link>
          ) : (
            <Button
              full
              variant={round.status === "ACTIVE" ? "outline" : "primary"}
              loading={busy}
              onClick={onToggle}
            >
              {round.status === "ACTIVE" ? "Дэлгүүрээс нуух" : "Дэлгүүрт гаргах"}
            </Button>
          )}
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" className="flex-1" onClick={onEditRound}>
              {expired && !isOrder ? "Үлдэгдэл нэмэх" : "Үнэ, огноо"}
            </Button>
            <Button size="sm" variant="ghost" className="flex-1" onClick={onEditProduct}>
              Нэр, зураг
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Fact({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "ok" | "danger";
}) {
  const colors = { neutral: "text-ink", ok: "text-ok", danger: "text-danger" };
  return (
    <div className="leading-[1.35]">
      <div className="text-[12px] text-muted">{label}</div>
      <div className={`tnum text-[13px] ${colors[tone]}`}>{value}</div>
    </div>
  );
}
