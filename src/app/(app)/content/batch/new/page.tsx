import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { isOpenRouterConfigured } from "@/features/ai/openrouter";
import { BatchForm } from "@/features/content/batch-form";
import type { ProductOption } from "@/features/content/new-project-form";
import { TEMPLATES } from "@/features/content/templates";
import { fieldStatus, type Provenance } from "@/features/products/schema";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "สร้างหลายวิดีโอ" };

export default async function NewBatchPage() {
  const { supabase } = await getCurrentUser();
  const { data: products } = await supabase!.from("products").select("id, name, price, provenance, retrieved_at, updated_at, product_facts(count)").order("name").limit(1000);
  const options: ProductOption[] = (products ?? []).map((p) => {
    const s = fieldStatus({ ...p, provenance: p.provenance as Provenance }, "price");
    return { id: p.id, name: p.name, price: s === "unavailable" ? "missing" : s === "stale" ? "stale" : "ok", factCount: p.product_facts[0]?.count ?? 0 };
  });
  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "วางแผนคอนเทนต์", href: "/content" }, { label: "สร้างหลายวิดีโอ", href: "/content/batch" }, { label: "ชุดใหม่" }]}
        title="สร้างหลายวิดีโอ"
        description="เลือกหลายสินค้า ระบบร่างสคริปต์ให้ทีละงาน (และให้ AI เขียนถ้าเลือก) แล้วคุณตรวจและอนุมัติทีละงานใน Script Studio"
      />
      <BatchForm products={options} templates={TEMPLATES.map(({ id, name, description, needs }) => ({ id, name, description, needs }))} aiReady={isOpenRouterConfigured()} />
    </>
  );
}
