import type { ReactNode } from "react";
import { CartProvider } from "@/lib/cart";
import { SessionProvider } from "@/lib/session";


export default function ShopLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <CartProvider>{children}</CartProvider>
    </SessionProvider>
  );
}
