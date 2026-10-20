"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { deleteProduct } from "./actions";

export function DeleteProductButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" className="text-destructive hover:bg-destructive-subtle hover:text-destructive">
          <Trash2 aria-hidden /> ลบ
        </Button>
      }
      title="ลบสินค้านี้?"
      description={
        <>
          “{name}” และประวัติราคาจะถูกลบถาวร ย้อนกลับไม่ได้
        </>
      }
      confirmLabel="ลบสินค้า"
      onConfirm={async () => {
        const res = await deleteProduct(id);
        if (!res.ok) return res.error;
        toast.success("ลบสินค้าแล้ว");
        router.push("/products");
      }}
    />
  );
}
