import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { createProduct } from "@/features/products/actions";
import { ProductForm } from "@/features/products/product-form";

export const metadata: Metadata = { title: "เพิ่มสินค้า" };

export default function NewProductPage() {
  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "สินค้า", href: "/products" }, { label: "เพิ่มสินค้า" }]}
        title="เพิ่มสินค้า"
        description="ข้อมูลที่กรอกจะติดป้าย “ผู้ใช้กรอก” เพื่อแยกจากข้อมูลที่ยืนยันจากแหล่ง"
      />
      <ProductForm action={createProduct} cancelHref="/products" submitLabel="บันทึกสินค้า" />
    </>
  );
}
