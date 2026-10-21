import { LayoutPanelTop, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { Notice } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { getTemplate, type Platform, PLATFORM_LABEL } from "@/features/content/templates";
import { loadVideoStudio } from "@/features/video/studio-data";
import { ClipsSection, OutputSection, RenderAside, RenderHistory } from "@/features/video/studio-sections";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Video Studio" };

export default async function VideoPage({ params }: { params: Promise<{ storyboardId: string }> }) {
  const { storyboardId } = await params;
  if (!z.uuid().safeParse(storyboardId).success) notFound();
  const { supabase } = await getCurrentUser();
  const d = await loadVideoStudio(supabase!, storyboardId);
  if (!d) notFound();
  const { sb, project, preview } = d;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Video Studio", href: "/videos" }, { label: project.title }]}
        title={project.title}
        meta={
          <>
            <StatusBadge status={sb.status === "approved" ? "approved" : "draft"} />
            <span>เวอร์ชัน {sb.version}</span>
            <span>{getTemplate(sb.template_id)?.name ?? sb.template_id}</span>
            <span>
              {PLATFORM_LABEL[project.platform as Platform]} · ประมาณ {(preview.durationInFrames / preview.fps).toFixed(1)} วินาที
            </span>
          </>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href={`/workspace/${sb.id}`}>
                <LayoutPanelTop aria-hidden /> เปิดในห้องทำวิดีโอ
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/studio/${sb.id}`}>
                <Pencil aria-hidden /> เปิดใน Script Studio
              </Link>
            </Button>
          </div>
        }
      />

      {sb.status !== "approved" ? (
        <Notice tone="warning">
          สคริปต์นี้ยังไม่อนุมัติ จึง render ไม่ได้ —{" "}
          <Link href={`/studio/${sb.id}`} className="font-medium text-primary hover:underline">
            ตรวจและอนุมัติใน Script Studio
          </Link>
        </Notice>
      ) : null}

      <div className="mt-4 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6 lg:order-1">
          <OutputSection d={d} />
          <ClipsSection d={d} />
        </div>
        {/* Render controls first on small screens; beside the video on large ones. */}
        <aside aria-label="Render" className="order-first flex flex-col gap-4 lg:sticky lg:top-4 lg:order-2">
          <RenderAside d={d} />
        </aside>
      </div>
      <RenderHistory d={d} />
    </>
  );
}
