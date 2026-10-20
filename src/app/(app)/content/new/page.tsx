import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { NewProjectForm, type ProductOption } from "@/features/content/new-project-form";
import { TEMPLATES } from "@/features/content/templates";
import { fieldStatus, type Provenance } from "@/features/products/schema";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "สร้างคอนเทนต์" };

export default async function NewContentPage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const { product } = await searchParams;
  const { supabase } = await getCurrentUser();
  const db = supabase!;
  const { data: products } = await db.from("products").select("id, name, price, provenance, retrieved_at, updated_at, product_facts(count)").order("name").limit(1000);
  const options: ProductOption[] = (products ?? []).map((p) => {
    const s = fieldStatus({ ...p, provenance: p.provenance as Provenance }, "price");
    return { id: p.id, name: p.name, price: s === "unavailable" ? "missing" : s === "stale" ? "stale" : "ok", factCount: p.product_facts[0]?.count ?? 0 };
  });

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "วางแผนคอนเทนต์", href: "/content" }, { label: "สร้างคอนเทนต์" }]}
        title="สร้างคอนเทนต์"
        description="เลือกสินค้า รูปแบบ และความยาว ระบบจะสร้างฉบับร่างจากข้อเท็จจริงของสินค้าเท่านั้น"
      />
      <NewProjectForm
        products={options}
        templates={TEMPLATES.map(({ id, name, description, needs }) => ({ id, name, description, needs }))}
        initialProductId={options.some((o) => o.id === product) ? product! : null}
      />
    </>
  );
}
