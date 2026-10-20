import Papa from "papaparse";
import { parseDateCell, parseNumberCell } from "@/features/products/schema";
import { postKey } from "./post-key";

/**
 * Parsers for analytics CSV exports. Columns are found by header name (English or Thai), so
 * TikTok Studio, YouTube Studio, Instagram and hand-made sheets all work. Bad rows are reported
 * with their line number and skipped; good rows are kept. Missing values stay null, never 0.
 */

export const MAX_ANALYTICS_ROWS = 20_000;

export interface LineError {
  line: number;
  message: string;
}

interface FieldDef<K extends string> {
  key: K;
  exact: string[];
  contains: string[];
}

const norm = (s: string) =>
  s
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ");

/** Column index per field. Exact names win over partial ones; a column is used once. */
function findColumns<K extends string>(header: string[], fields: FieldDef<K>[]): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  const used = new Set<number>();
  const names = header.map(norm);
  for (const pass of ["exact", "contains"] as const) {
    for (const f of fields) {
      if (out[f.key] !== undefined) continue;
      // Hints are in priority order: the first hint that matches any column wins.
      const hints = pass === "exact" ? f.exact : f.contains;
      let i = -1;
      for (const h of hints) {
        i = names.findIndex((n, idx) => !used.has(idx) && (pass === "exact" ? n === h : n.includes(h)));
        if (i !== -1) break;
      }
      if (i !== -1) {
        out[f.key] = i;
        used.add(i);
      }
    }
  }
  return out;
}

function readRows(text: string): string[][] {
  return Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" }).data.map((r) => r.map((c) => (c ?? "").trim()));
}

/** Header = first of the top 10 rows that has the required columns (exports may have a preamble). */
function locateHeader<K extends string>(rows: string[][], fields: FieldDef<K>[], ok: (cols: Partial<Record<K, number>>) => boolean) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cols = findColumns(rows[i], fields);
    if (ok(cols)) return { index: i, cols };
  }
  return null;
}

function count(raw: string | undefined, label: string, errors: string[]): number | null {
  const n = parseNumberCell(raw ?? "");
  if (n === null) return null;
  if (Number.isNaN(n) || n < 0 || !Number.isInteger(n)) {
    errors.push(`${label} “${raw}” ต้องเป็นจำนวนเต็มไม่ติดลบ`);
    return null;
  }
  return n;
}

/** "83", "83.5", "83s", "1:23", "1:02:03" → seconds. */
export function parseDuration(raw: string | undefined): number | null | "invalid" {
  const s = (raw ?? "").trim().replace(/\s*(s|sec|secs|seconds|วินาที)$/i, "");
  if (s === "" || s === "-" || /^n\/?a$/i.test(s)) return null;
  if (/^\d+(\.\d+)?$/.test(s.replace(/,/g, ""))) return Number(s.replace(/,/g, ""));
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$/.exec(s);
  if (!m) return "invalid";
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

// ---------------------------------------------------------------------------
// Post metrics
// ---------------------------------------------------------------------------

type MetricField = "post_url" | "post_id" | "title" | "date" | "views" | "likes" | "comments" | "shares" | "saves" | "avg_watch" | "watch_hours" | "watch_time";

// Order matters for the partial pass: more specific names first.
const METRIC_FIELDS: FieldDef<MetricField>[] = [
  { key: "post_url", exact: ["video link", "post link", "link", "url", "permalink", "ลิงก์", "ลิงก์วิดีโอ", "ลิงก์โพสต์"], contains: ["video link", "post link", "url", "permalink", "ลิงก์วิดีโอ", "ลิงก์โพสต์"] },
  { key: "post_id", exact: ["video id", "post id", "content", "id", "รหัสวิดีโอ", "รหัสโพสต์", "เนื้อหา"], contains: ["video id", "post id", "รหัสวิดีโอ", "รหัสโพสต์"] },
  { key: "title", exact: ["video title", "title", "caption", "description", "ชื่อวิดีโอ", "คำบรรยาย", "ชื่อ"], contains: ["title", "caption", "ชื่อวิดีโอ"] },
  { key: "date", exact: ["date", "as of", "data date", "snapshot date", "วันที่", "วันที่ข้อมูล", "ข้อมูล ณ วันที่"], contains: ["as of", "data date", "snapshot", "วันที่ข้อมูล", "ณ วันที่"] },
  { key: "avg_watch", exact: ["average watch time", "average view duration", "avg watch time", "avg. watch time", "เวลาดูเฉลี่ย", "ระยะเวลาการดูเฉลี่ย"], contains: ["average watch", "average view duration", "avg watch", "avg. watch", "เฉลี่ย"] },
  { key: "watch_hours", exact: ["watch time (hours)", "เวลาในการรับชม (ชั่วโมง)"], contains: ["(hours)", "(ชั่วโมง)"] },
  { key: "watch_time", exact: ["total play time", "total watch time", "watch time", "เวลาดูรวม", "เวลาในการรับชม"], contains: ["total play time", "total watch time", "watch time", "เวลาดูรวม"] },
  { key: "views", exact: ["video views", "views", "plays", "play count", "ยอดดู", "จำนวนการดู", "การดู"], contains: ["views", "plays", "ยอดดู", "การดู"] },
  { key: "likes", exact: ["likes", "ถูกใจ", "ยอดถูกใจ", "ไลก์"], contains: ["likes", "ถูกใจ", "ไลก์"] },
  { key: "comments", exact: ["comments", "comments added", "ความคิดเห็น", "คอมเมนต์"], contains: ["comments", "ความคิดเห็น", "คอมเมนต์"] },
  { key: "shares", exact: ["shares", "แชร์", "การแชร์"], contains: ["shares", "แชร์"] },
  { key: "saves", exact: ["saves", "saved", "favorites", "บันทึก", "การบันทึก"], contains: ["saves", "favorites", "บันทึก"] },
];

const METRIC_VALUES: MetricField[] = ["views", "likes", "comments", "shares", "saves", "avg_watch", "watch_hours", "watch_time"];

export interface MetricRow {
  line: number;
  post_key: string;
  post_url: string | null;
  title: string | null;
  captured_on: string; // YYYY-MM-DD
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  watch_time_s: number | null;
  avg_watch_s: number | null;
}

export type ParsedFile<T> = { ok: true; rows: T[]; errors: LineError[]; total: number; columns: string[] } | { ok: false; error: string };

/** `fallbackDate`: used when the file has no date column (YYYY-MM-DD, e.g. the download day). */
export function parsePostMetricsCsv(text: string, fallbackDate: string): ParsedFile<MetricRow> {
  const rows = readRows(text);
  const found = locateHeader(rows, METRIC_FIELDS, (c) => (c.post_url !== undefined || c.post_id !== undefined) && METRIC_VALUES.some((k) => c[k] !== undefined));
  if (!found) return { ok: false, error: "ไม่พบหัวตารางที่ต้องใช้: ต้องมีคอลัมน์ลิงก์โพสต์หรือรหัสวิดีโอ และตัวเลขอย่างน้อยหนึ่งอย่าง (เช่น Views / ยอดดู)" };
  const { index, cols } = found;
  const body = rows.slice(index + 1);
  if (body.length > MAX_ANALYTICS_ROWS) return { ok: false, error: `ไฟล์มีเกิน ${MAX_ANALYTICS_ROWS.toLocaleString()} แถว` };

  const out: MetricRow[] = [];
  const errors: LineError[] = [];
  const cell = (r: string[], k: MetricField) => (cols[k] === undefined ? undefined : r[cols[k]!]);
  body.forEach((r, i) => {
    const line = index + i + 2;
    const url = cell(r, "post_url") || "";
    const id = cell(r, "post_id") || "";
    // YouTube Studio puts a "Total" row first.
    if (/^(total|รวม|ทั้งหมด)$/i.test(id || url)) return;
    const key = postKey(url) ?? postKey(id);
    const rowErrors: string[] = [];
    if (!key) rowErrors.push("ไม่มีลิงก์โพสต์หรือรหัสวิดีโอ");
    if (url && !/^https?:\/\//i.test(url) && !id) rowErrors.push(`ลิงก์ “${url}” ไม่ถูกต้อง`);

    let capturedOn = fallbackDate;
    const rawDate = cell(r, "date");
    if (rawDate) {
      const d = parseDateCell(rawDate);
      if (!d || d === "invalid") rowErrors.push(`วันที่ “${rawDate}” ไม่ถูกต้อง`);
      else capturedOn = d.slice(0, 10);
    }

    const avg = parseDuration(cell(r, "avg_watch"));
    if (avg === "invalid") rowErrors.push(`เวลาดูเฉลี่ย “${cell(r, "avg_watch")}” ไม่ถูกต้อง`);
    let watch: number | null | "invalid" = null;
    if (cols.watch_hours !== undefined) {
      const h = parseNumberCell(cell(r, "watch_hours") ?? "");
      watch = h === null ? null : Number.isNaN(h) || h < 0 ? "invalid" : Math.round(h * 3600 * 10) / 10;
    } else watch = parseDuration(cell(r, "watch_time"));
    if (watch === "invalid") rowErrors.push("เวลาดูรวมไม่ถูกต้อง");

    const row: MetricRow = {
      line,
      post_key: key ?? "",
      post_url: /^https?:\/\//i.test(url) ? url.slice(0, 2000) : null,
      title: cell(r, "title")?.slice(0, 300) || null,
      captured_on: capturedOn,
      views: count(cell(r, "views"), "ยอดดู", rowErrors),
      likes: count(cell(r, "likes"), "ถูกใจ", rowErrors),
      comments: count(cell(r, "comments"), "ความคิดเห็น", rowErrors),
      shares: count(cell(r, "shares"), "แชร์", rowErrors),
      saves: count(cell(r, "saves"), "บันทึก", rowErrors),
      watch_time_s: watch === "invalid" ? null : watch,
      avg_watch_s: avg === "invalid" ? null : avg,
    };
    if (rowErrors.length) errors.push({ line, message: rowErrors.join(" · ") });
    else out.push(row);
  });

  // The same post twice in one file for the same day: keep the last.
  const byKey = new Map(out.map((r) => [`${r.post_key}|${r.captured_on}`, r]));
  return { ok: true, rows: [...byKey.values()], errors, total: out.length + errors.length, columns: Object.keys(cols) };
}

// ---------------------------------------------------------------------------
// Affiliate conversions (Shopee Affiliate conversion report)
// ---------------------------------------------------------------------------

type ConvField = "order_id" | "status" | "ordered_at" | "item_id" | "item_name" | "order_value" | "commission";

const CONV_FIELDS: FieldDef<ConvField>[] = [
  { key: "order_id", exact: ["order id", "order sn", "order no", "รหัสคำสั่งซื้อ", "หมายเลขคำสั่งซื้อ"], contains: ["order id", "order sn", "รหัสคำสั่งซื้อ", "หมายเลขคำสั่งซื้อ"] },
  { key: "status", exact: ["order status", "status", "สถานะคำสั่งซื้อ", "สถานะ"], contains: ["order status", "สถานะคำสั่งซื้อ", "status", "สถานะ"] },
  { key: "ordered_at", exact: ["purchase time", "order time", "order date", "เวลาที่สั่งซื้อ", "เวลาสั่งซื้อ", "วันที่สั่งซื้อ"], contains: ["purchase time", "order time", "order date", "สั่งซื้อเมื่อ", "เวลาที่สั่งซื้อ", "วันที่สั่งซื้อ"] },
  { key: "item_id", exact: ["item id", "product id", "รหัสสินค้า"], contains: ["item id", "รหัสสินค้า"] },
  { key: "item_name", exact: ["item name", "product name", "ชื่อสินค้า"], contains: ["item name", "product name", "ชื่อสินค้า"] },
  { key: "order_value", exact: ["purchase value", "purchase value(฿)", "order amount", "order value", "ยอดซื้อ", "มูลค่าการสั่งซื้อ", "มูลค่าคำสั่งซื้อ"], contains: ["purchase value", "order amount", "order value", "ยอดซื้อ", "มูลค่า"] },
  { key: "commission", exact: ["net commission", "net commission(฿)", "total commission", "commission", "ค่าคอมมิชชันสุทธิ", "ค่าคอมมิชชัน", "ค่าคอม"], contains: ["net commission", "total commission", "ค่าคอมมิชชันสุทธิ", "commission", "ค่าคอมมิชชัน", "ค่าคอม"] },
];

export type ConversionStatus = "completed" | "pending" | "cancelled" | "unknown";

export function normalizeStatus(raw: string | undefined): ConversionStatus {
  const s = (raw ?? "").toLowerCase();
  if (!s.trim()) return "unknown";
  if (/cancel|invalid|refund|return|ยกเลิก|ไม่ถูกต้อง|คืน|ไม่สำเร็จ/.test(s)) return "cancelled";
  if (/complet|paid|settled|สำเร็จ|เสร็จ|ชำระแล้ว|ยืนยันแล้ว/.test(s)) return "completed";
  if (/pending|ordered|unpaid|processing|รอ|กำลัง/.test(s)) return "pending";
  return "unknown";
}

/** Report times have no zone; Shopee TH reports in Thai time. */
export function parseOrderTime(raw: string | undefined): string | null | "invalid" {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const iso = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(s);
  if (iso) {
    const d = new Date(`${iso[1]}T${iso[2]}+07:00`);
    return Number.isNaN(d.getTime()) ? "invalid" : d.toISOString();
  }
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (dmy) {
    const [day, month, y, h, mi, sec] = dmy.slice(1).map((v) => Number(v ?? 0));
    const year = y > 2400 ? y - 543 : y;
    const d = new Date(Date.UTC(year, month - 1, day, h - 7, mi, sec));
    return Number.isNaN(d.getTime()) || d.getUTCDate() === 0 ? "invalid" : d.toISOString();
  }
  const d = parseDateCell(s);
  return d === null ? null : d;
}

export interface ConversionRow {
  line: number;
  order_id: string;
  item_key: string;
  item_name: string | null;
  status: ConversionStatus;
  raw_status: string | null;
  ordered_at: string | null;
  order_value_thb: number | null;
  commission_thb: number | null;
  sub_ids: string[];
}

export function parseConversionsCsv(text: string): ParsedFile<ConversionRow> {
  const rows = readRows(text);
  const found = locateHeader(rows, CONV_FIELDS, (c) => c.order_id !== undefined && c.commission !== undefined);
  if (!found) return { ok: false, error: "ไม่พบหัวตารางที่ต้องใช้: ต้องมีคอลัมน์รหัสคำสั่งซื้อ (Order ID) และค่าคอมมิชชัน (Commission) — ใช้รายงาน Conversion จาก Shopee Affiliate" };
  const { index, cols } = found;
  const header = rows[index].map(norm);
  const subCols = header.flatMap((h, i) => (/^sub ?id ?\d*$|^sub ?id/.test(h) ? [i] : []));
  const body = rows.slice(index + 1);
  if (body.length > MAX_ANALYTICS_ROWS) return { ok: false, error: `ไฟล์มีเกิน ${MAX_ANALYTICS_ROWS.toLocaleString()} แถว` };

  const out: ConversionRow[] = [];
  const errors: LineError[] = [];
  const cell = (r: string[], k: ConvField) => (cols[k] === undefined ? undefined : r[cols[k]!]);
  body.forEach((r, i) => {
    const line = index + i + 2;
    const orderId = (cell(r, "order_id") ?? "").trim();
    const rowErrors: string[] = [];
    if (!orderId) rowErrors.push("ไม่มีรหัสคำสั่งซื้อ");
    if (orderId.length > 100) rowErrors.push("รหัสคำสั่งซื้อยาวเกินไป");
    const commission = parseNumberCell(cell(r, "commission") ?? "");
    if (Number.isNaN(commission)) rowErrors.push(`ค่าคอม “${cell(r, "commission")}” ต้องเป็นตัวเลข`);
    const value = parseNumberCell(cell(r, "order_value") ?? "");
    if (Number.isNaN(value) || (value !== null && value < 0)) rowErrors.push(`ยอดซื้อ “${cell(r, "order_value")}” ไม่ถูกต้อง`);
    const at = parseOrderTime(cell(r, "ordered_at"));
    if (at === "invalid") rowErrors.push(`เวลาสั่งซื้อ “${cell(r, "ordered_at")}” ไม่ถูกต้อง`);
    if (rowErrors.length) return void errors.push({ line, message: rowErrors.join(" · ") });

    const itemName = cell(r, "item_name")?.slice(0, 300) || null;
    out.push({
      line,
      order_id: orderId,
      item_key: (cell(r, "item_id") || itemName || "").slice(0, 300),
      item_name: itemName,
      status: normalizeStatus(cell(r, "status")),
      raw_status: cell(r, "status")?.slice(0, 100) || null,
      ordered_at: at as string | null,
      order_value_thb: value,
      commission_thb: commission,
      sub_ids: subCols.map((c) => (r[c] ?? "").trim().toLowerCase()).filter(Boolean),
    });
  });
  const byKey = new Map(out.map((r) => [`${r.order_id}|${r.item_key}`, r]));
  return { ok: true, rows: [...byKey.values()], errors, total: out.length + errors.length, columns: [...Object.keys(cols), ...(subCols.length ? ["sub_id"] : [])] };
}
