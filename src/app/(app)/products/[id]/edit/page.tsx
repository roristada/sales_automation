import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { updateProduct } from "@/features/products/actions";
import { ProductForm } from "@/features/products/product-form";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "แก้ไขสินค้า" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await getCurrentUser();
  const { data: product } = await supabase!.from("products").select("*").eq("id", id).maybeSingle();
  if (!product) notFound();

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "สินค้า", href: "/products" }, { label: product.name, href: `/products/${id}` }, { label: "แก้ไข" }]}
        title="แก้ไขสินค้า"
        description="ช่องที่แก้ไขจะเปลี่ยนสถานะเป็น “ผู้ใช้กรอก” ช่องที่ไม่แตะจะคงสถานะเดิม"
      />
      <ProductForm action={updateProduct.bind(null, id)} defaults={product} cancelHref={`/products/${id}`} submitLabel="บันทึกการแก้ไข" />
    </>
  );
}
