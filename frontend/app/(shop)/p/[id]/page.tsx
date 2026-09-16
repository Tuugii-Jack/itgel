import { ProductDetail } from "@/features/catalog/components/product/ProductDetail";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ProductDetail params={params} />;
}
