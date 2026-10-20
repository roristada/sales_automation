/**
 * Asset licensing rules (design.md §9.7: flag unknown licensing; never imply an asset is safe
 * for commercial use). Affiliate videos are commercial, so:
 * - non-commercial licenses block approval/rendering,
 * - unknown licenses and CC BY without attribution are warnings the user must look at.
 */

export const ASSET_SOURCES = ["own", "stock", "brand_supplied", "ai_generated", "product_page", "other"] as const;
export type AssetSource = (typeof ASSET_SOURCES)[number];
export const ASSET_LICENSES = ["own_work", "commercial_license", "cc_by", "cc0", "brand_permission", "non_commercial", "unknown"] as const;
export type AssetLicense = (typeof ASSET_LICENSES)[number];

export const SOURCE_LABEL: Record<AssetSource, string> = {
  own: "ถ่าย/ทำเอง",
  stock: "คลังภาพ/วิดีโอ (stock)",
  brand_supplied: "ได้จากแบรนด์/ร้านค้า",
  ai_generated: "สร้างด้วย AI",
  product_page: "จากหน้าสินค้า",
  other: "อื่นๆ",
};

export const LICENSE_LABEL: Record<AssetLicense, string> = {
  own_work: "งานของฉันเอง",
  commercial_license: "มีสิทธิ์ใช้เชิงพาณิชย์ (ซื้อ/สัญญา)",
  cc_by: "CC BY (ต้องให้เครดิต)",
  cc0: "CC0 / Public domain",
  brand_permission: "แบรนด์อนุญาตแล้ว",
  non_commercial: "ห้ามใช้เชิงพาณิชย์",
  unknown: "ไม่ทราบสิทธิ์",
};

export interface LicenseInput {
  license: string;
  attribution: string | null;
  source: string;
  ai_generated: boolean;
}

export interface LicenseVerdict {
  level: "ok" | "warn" | "block";
  message: string;
}

export function licenseVerdict(a: LicenseInput): LicenseVerdict {
  if (a.license === "non_commercial") return { level: "block", message: "สิทธิ์ห้ามใช้เชิงพาณิชย์ — ใช้ในวิดีโอ affiliate ไม่ได้" };
  if (a.license === "unknown") return { level: "warn", message: "ไม่ทราบสิทธิ์การใช้งาน — ตรวจสอบก่อนใช้ในงานเชิงพาณิชย์" };
  if (a.license === "cc_by" && !a.attribution?.trim()) return { level: "warn", message: "CC BY ต้องให้เครดิต — ใส่ข้อความเครดิต" };
  if (a.source === "product_page" && a.license !== "brand_permission" && a.license !== "commercial_license") {
    return { level: "warn", message: "รูปจากหน้าสินค้ามักเป็นของร้าน/แบรนด์ — ตรวจว่าได้รับอนุญาต" };
  }
  return { level: "ok", message: a.ai_generated ? "ใช้ได้ (สร้างด้วย AI — บางแพลตฟอร์มให้ติดป้ายเนื้อหา AI)" : "ใช้ได้" };
}

export const ACCEPTED_TYPES: Record<string, { kind: "image" | "video"; ext: string; maxBytes: number }> = {
  "image/jpeg": { kind: "image", ext: "jpg", maxBytes: 20 * 1024 * 1024 },
  "image/png": { kind: "image", ext: "png", maxBytes: 20 * 1024 * 1024 },
  "image/webp": { kind: "image", ext: "webp", maxBytes: 20 * 1024 * 1024 },
  "video/mp4": { kind: "video", ext: "mp4", maxBytes: 200 * 1024 * 1024 },
  "video/quicktime": { kind: "video", ext: "mov", maxBytes: 200 * 1024 * 1024 },
  "video/webm": { kind: "video", ext: "webm", maxBytes: 200 * 1024 * 1024 },
};
