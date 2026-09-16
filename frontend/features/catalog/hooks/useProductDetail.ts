import { useEffect, useState } from "react";
import { useCountdown } from "@/components/ProductCard";
import { api, ApiError } from "@/lib/api";
import { useCart } from "@/lib/cart";
import {
  optionValueSoldOut,
  priceForSelections,
  productClosed,
  productSoldOut,
  selectedSkuStock,
} from "@/lib/options";
import { useToast } from "@/lib/toast";
import type { Product, Store } from "@/lib/types";

export function useProductDetail(id: string) {
  const cart = useCart();
  const toast = useToast();

  const [product, setProduct] = useState<Product | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [qty, setQty] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.product(id), api.store()])
      .then(([p, s]) => {
        setProduct(p);
        setStore(s);
        const initial: Record<string, string> = {};
        for (const opt of p.options ?? []) {
          if (opt.values.length !== 1) continue;
          const value = opt.values[0]!;
          const gone = p.type === "ready" && optionValueSoldOut(p.skuStocks, {}, opt.name, value);
          if (gone) continue;
          initial[opt.name] = value;
        }
        setSelections(initial);
      })
      .catch((e: ApiError) => setError(e.message));
  }, [id]);

  const closeLabel = useCountdown(product?.closeAt ?? null);

  const isOrder = product?.type === "order";
  const soldOut = product ? productSoldOut(product) : false;
  const closed = product
    ? productClosed(product) || closeLabel === "Хаагдсан"
    : false;
  const blocked = soldOut || closed;
  const options = product?.options ?? [];
  const missingOpt = options.find((o) => !selections[o.name]);
  const unitPrice = product
    ? priceForSelections(product.price, product.optionPrices, selections)
    : 0;
  const selectedStock = product
    ? selectedSkuStock(product.skuStocks, selections, options)
    : null;
  const lineStock = selectedStock != null ? selectedStock : product?.stock ?? 0;
  const selectedGone = !isOrder && selectedStock === 0;
  const cannotBuy =
    closed || soldOut || selectedGone || (!isOrder && lineStock <= 0);
  const qtyMax = isOrder ? 50 : Math.max(0, lineStock);
  const total = unitPrice * qty;

  const addToCart = () => {
    if (!product) return;
    if (closed) {
      const message = "Энэ барааны захиалга хаагдсан.";
      setNotice(message);
      toast.error(message);
      return;
    }
    if (missingOpt) {
      const message = `${missingOpt.name}-г сонгоно уу.`;
      setNotice(message);
      toast.error(message);
      return;
    }
    if (!isOrder && lineStock < qty) {
      const message = "Энэ сонголтын үлдэгдэл хүрэлцэхгүй байна.";
      setNotice(message);
      toast.error(message);
      return;
    }
    cart.add({
      productId: product.id,
      name: product.name,
      price: unitPrice,
      image: product.images[0] ?? null,
      type: product.type,
      selections: { ...selections },
      size: selections["Хэмжээ"] ?? null,
      color: selections["Өнгө"] ?? null,
      qty,
      arriveFrom: product.arriveFrom,
      arriveTo: product.arriveTo,
      stock: lineStock,
      ownerKind: product.ownerKind === "LEASING" ? "LEASING" : "SHOP",
    });
    toast.success("Сагсанд нэмэгдлээ. Өөр бараа нэмж болно.");
  };

  return {
    product,
    store,
    selections,
    setSelections,
    qty,
    setQty,
    error,
    notice,
    setNotice,
    closeLabel,
    addToCart,
    isOrder,
    soldOut,
    closed,
    blocked,
    options,
    missingOpt,
    unitPrice,
    selectedStock,
    lineStock,
    selectedGone,
    cannotBuy,
    qtyMax,
    total,
  };
}
