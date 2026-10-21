import "server-only";

import { isOpenRouterConfigured } from "@/features/ai/openrouter";
import { LLM_STATUS } from "@/features/content/llm";
import { TTS_STATUS } from "@/features/video/tts";
import { getSourceAdapter } from "@/features/sources/registry";
import { TREND_ADAPTERS } from "@/features/sources/trends";
import type { ConnectionState } from "@/features/sources/types";

export type IntegrationState = "connected" | "configured_untested" | "not_configured" | "not_available";

export interface IntegrationStatus {
  key: string;
  name: string;
  purpose: string;
  state: IntegrationState;
  note: string;
}

const FROM_SOURCE: Record<ConnectionState, IntegrationState> = {
  available: "connected",
  not_connected: "not_configured",
  not_available: "not_available",
};

/** Product sources report their own status through the adapter registry. */
function sourceStatus(key: "shopee_affiliate" | "tiktok_shop", statusKey: string, name: string, purpose: string): IntegrationStatus {
  const c = getSourceAdapter(key).connection();
  return { key: statusKey, name, purpose, state: FROM_SOURCE[c.state], note: c.note };
}

/**
 * Reports whether each provider is configured. Values are never
 * read into the response, so secrets cannot leak to the client (design.md §9.10).
 */
export function getIntegrationStatuses(): IntegrationStatus[] {
  return [
    {
      key: "supabase",
      name: "Supabase",
      purpose: "ฐานข้อมูลและการเข้าสู่ระบบ",
      state: "connected",
      note: "เชื่อมต่อแล้ว (หน้านี้โหลดข้อมูลจาก Supabase ได้)",
    },
    {
      key: "google_tts",
      name: "เสียงพากย์ (TTS)",
      purpose: "สร้างเสียงพากย์ภาษาไทย",
      state: FROM_SOURCE[TTS_STATUS.state],
      note: TTS_STATUS.note,
    },
    sourceStatus("shopee_affiliate", "shopee", "Shopee Affiliate", "ดึงข้อมูลสินค้าและค่าคอม"),
    sourceStatus("tiktok_shop", "tiktok", "TikTok Shop Affiliate", "ดึงข้อมูลสินค้า"),
    {
      key: "google_trends",
      name: "Google Trends API",
      purpose: "ดึงข้อมูลความสนใจของคีย์เวิร์ดอัตโนมัติ",
      state: FROM_SOURCE[TREND_ADAPTERS.google_trends_api.connection().state],
      note: TREND_ADAPTERS.google_trends_api.connection().note,
    },
    isOpenRouterConfigured()
      ? {
          key: "llm",
          name: "AI provider (OpenRouter)",
          purpose: "กรอกข้อมูล เขียนสคริปต์ และสร้างคลิป (ไม่บังคับ)",
          state: "configured_untested",
          note: "ตั้ง OPENROUTER_API_KEY แล้ว — สถานะจริง เพดาน และการทดสอบอยู่ในส่วน “AI (OpenRouter)”",
        }
      : {
          key: "llm",
          name: "AI provider (LLM)",
          purpose: "ช่วยร่างสคริปต์ (ไม่บังคับ)",
          state: FROM_SOURCE[LLM_STATUS.state],
          note: LLM_STATUS.note,
        },
  ];
}
