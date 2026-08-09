import type { ReactNode } from "react";
import { CartProvider } from "@/lib/cart";
import { SessionProvider } from "@/lib/session";

/**
 * Хуудас бүр өөрийн өргөнөө сонгоно (.page эсвэл .screen) — тиймээс
 * энд тогтмол багана тавихгүй.
 */
export default function ShopLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <CartProvider>{children}</CartProvider>
    </SessionProvider>
  );
}
