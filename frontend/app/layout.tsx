import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Кирилл үсэг заавал — ө, ү, ё зөв гарах ёстой.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "itgel — захиалгын дэлгүүр",
  description:
    "Гадаадаас захиалгаар бараа авчирдаг дэлгүүр. Одоо захиалж, 2-3 долоо хоногийн дараа авна.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="mn" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
