import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { CsvImport } from "@/features/products/csv-import";

export const metadata: Metadata = { title: "นำเข้า CSV" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams;
  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "สินค้า", href: "/products" }, { label: "นำเข้า CSV" }]}
        title="นำเข้าสินค้าจาก CSV"
        description="เลือกไฟล์ จับคู่คอลัมน์ ตรวจสอบ แล้วนำเข้า แถวที่ผิดจะถูกแยกไว้ ไม่บล็อกแถวอื่น"
      />
      <CsvImport initialMode={mode === "update" ? "update" : "skip"} />
    </>
  );
}
