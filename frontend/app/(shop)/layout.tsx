import type { ReactNode } from "react";
import { ShopHeader } from "@/components/ShopHeader";
import { CartProvider } from "@/lib/cart";
import { SessionProvider } from "@/lib/session";

export default function ShopLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <CartProvider>
        {/* Laptop-ийн нийтлэг толгой — нүүрээс бусад дэлгэцэд, lg-ээс дээш. */}
        <ShopHeader />
        {children}
      </CartProvider>
    </SessionProvider>
  );
}
