import type { ReactNode } from "react";
import { FloatingCart } from "@/components/layout/FloatingCart";
import { ShopHeader } from "@/components/layout/ShopHeader";
import { CartProvider } from "@/lib/cart";
import { SessionProvider } from "@/lib/session";

export default function ShopLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <CartProvider>
        <ShopHeader />
        {children}
        <FloatingCart />
      </CartProvider>
    </SessionProvider>
  );
}
