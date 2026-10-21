import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { Chip, StatusBadge } from "@/components/shared/status-badge";
import { isOpenRouterConfigured } from "@/features/ai/openrouter";
import { LLM_STATUS } from "@/features/content/llm";
import { loadStudio } from "@/features/content/queries";
import { StudioShell } from "@/features/content/studio-shell";
import { getTemplate, type Platform, PLATFORM_LABEL } from "@/features/content/templates";
import { formatDateTime } from "@/features/products/data-value";
import { getCurrentUser } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Script Studio" };

export default async function StudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { supabase } = await getCurrentUser();
  const bundle = await loadStudio(supabase!, id);
  if (!bundle) notFound();
  const { storyboard: sb, project, product, scenes, facts, issues, versions, assets } = bundle;
  const locked = sb.status === "approved";

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Script Studio", href: "/studio" }, { label: project.title }]}
        title={project.title}
        meta={
          <>
            <StatusBadge status={locked ? "approved" : "draft"} />
            <Link href={`/products/${product.id}`} className="hover:underline">
              {product.name}
            </Link>
            <span>{getTemplate(sb.template_id)?.name ?? sb.template_id}</span>
            <span>
              {PLATFORM_LABEL[project.platform as Platform]} · {project.target_duration_s} วินาที
            </span>
            {locked && sb.approved_at && <span>อนุมัติเมื่อ {formatDateTime(sb.approved_at)}</span>}
          </>
        }
      />

      {versions.length > 1 && (
        <nav aria-label="เวอร์ชัน" className="mb-5 flex flex-wrap items-center gap-1 text-[13px]">
          <span className="mr-1 text-muted-foreground">เวอร์ชัน</span>
          {versions.map((v) => (
            <Link
              key={v.id}
              href={`/studio/${v.id}`}
              aria-current={v.id === sb.id ? "page" : undefined}
              className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-1 hover:bg-surface-muted", v.id === sb.id && "border-primary bg-primary-subtle")}
            >
              {v.version}
              {v.status === "approved" && <Chip tone="success">อนุมัติ</Chip>}
            </Link>
          ))}
        </nav>
      )}

      <StudioShell
        storyboardId={sb.id}
        productId={product.id}
        hook={sb.hook}
        caption={sb.caption}
        cta={sb.cta}
        disclosure={sb.disclosure}
        scenes={scenes}
        facts={facts}
        issues={issues}
        locked={locked}
        targetSeconds={project.target_duration_s}
        approvedAt={sb.approved_at}
        llmNote={
          isOpenRouterConfigured()
            ? "เชื่อม AI ผ่าน OpenRouter แล้ว — กด “ให้ AI เขียนทั้งสคริปต์” หรือ “AI ช่วยเขียน” ในแต่ละฉาก (โมเดลและเพดานค่าใช้จ่ายตั้งได้ที่หน้าตั้งค่า) ปุ่มคัดลอกคำสั่งไปแชท AI ยังใช้ได้"
            : LLM_STATUS.note
        }
        assets={assets}
        promptContext={{
          productName: product.name,
          templateName: getTemplate(sb.template_id)?.name ?? sb.template_id,
          platformLabel: PLATFORM_LABEL[project.platform as Platform],
          targetSeconds: project.target_duration_s,
          aiReady: isOpenRouterConfigured(),
        }}
      />
    </>
  );
}
