"use client";

import { useState } from "react";
import { formatDate } from "@/features/products/data-value";
import type { TrendPoint } from "./google-trends-csv";

const fmtValue = (p: TrendPoint) => (p.belowOne ? "<1" : String(p.value));

/**
 * Tiny single-series line for table rows. Decorative: the row shows the numbers in text,
 * so it is hidden from assistive tech.
 */
export function Sparkline({ points, width = 96, height = 28 }: { points: TrendPoint[]; width?: number; height?: number }) {
  if (points.length < 2) return null;
  const pad = 4;
  const x = (i: number) => pad + (i / (points.length - 1)) * (width - pad * 2);
  const y = (v: number) => pad + (1 - v / 100) * (height - pad * 2);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const last = points[points.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="shrink-0 overflow-visible">
      <path d={d} fill="none" className="stroke-primary" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(points.length - 1)} cy={y(last.value)} r={3} className="fill-primary stroke-surface" strokeWidth={2} />
    </svg>
  );
}

/**
 * Interest-over-time line chart (0–100) with a crosshair tooltip that snaps to the nearest period,
 * arrow-key navigation, and a table view so no value depends on hovering.
 * `partial`: the last period was still in progress and is drawn faded.
 */
export function TrendChart({ points, label, partial }: { points: TrendPoint[]; label: string; partial: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const W = 640;
  const H = 180;
  const m = { top: 12, right: 36, bottom: 24, left: 28 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const n = points.length;
  const x = (i: number) => m.left + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => m.top + (1 - v / 100) * ih;
  const solid = partial ? points.slice(0, -1) : points;
  const path = (pts: TrendPoint[], offset = 0) => pts.map((p, i) => `${i ? "L" : "M"}${x(i + offset).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const area = solid.length > 1 ? `${path(solid)}L${x(solid.length - 1)},${y(0)}L${x(0)},${y(0)}Z` : "";
  const lastSolid = solid.length - 1;
  const ticks = [0, 50, 100];
  const xLabels = n > 1 ? [0, Math.floor((n - 1) / 2), n - 1] : [0];

  function nearest(clientX: number, rect: DOMRect) {
    const px = ((clientX - rect.left) / rect.width) * W;
    return Math.max(0, Math.min(n - 1, Math.round(((px - m.left) / iw) * (n - 1))));
  }

  const a = active === null ? null : points[active];
  return (
    <figure className="min-w-0">
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          role="img"
          aria-label={`${label}: ความสนใจตามช่วงเวลา ${n} ช่วง ล่าสุด ${solid.length ? fmtValue(solid[lastSolid]) : "—"} จาก 100 — ใช้ลูกศรซ้ายขวาเพื่ออ่านทีละช่วง`}
          tabIndex={0}
          onPointerMove={(e) => setActive(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              setActive((cur) => Math.max(0, Math.min(n - 1, (cur ?? n - 1) + (e.key === "ArrowLeft" ? -1 : 1))));
            } else if (e.key === "Escape") setActive(null);
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.left} x2={W - m.right} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
              <text x={m.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px]">
                {t}
              </text>
            </g>
          ))}
          {xLabels.map((i, k) => (
            <text key={i} x={x(i)} y={H - 6} textAnchor={k === 0 ? "start" : k === xLabels.length - 1 ? "end" : "middle"} className="fill-muted-foreground text-[10px]">
              {formatDate(points[i].periodStart)}
            </text>
          ))}
          {area && <path d={area} className="fill-primary/10" />}
          {solid.length > 1 && <path d={path(solid)} fill="none" className="stroke-primary" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {partial && n > 1 && (
            <path d={path(points.slice(-2), n - 2)} fill="none" className="stroke-primary opacity-40" strokeWidth={2} strokeLinecap="round" />
          )}
          {lastSolid >= 0 && (
            <>
              <circle cx={x(lastSolid)} cy={y(solid[lastSolid].value)} r={4} className="fill-primary stroke-surface" strokeWidth={2} />
              <text x={x(lastSolid) + 8} y={y(solid[lastSolid].value)} dy="0.32em" className="fill-foreground text-[11px] font-medium">
                {fmtValue(solid[lastSolid])}
              </text>
            </>
          )}
          {a && active !== null && (
            <>
              <line x1={x(active)} x2={x(active)} y1={m.top} y2={m.top + ih} className="stroke-muted-foreground" strokeWidth={1} />
              <circle cx={x(active)} cy={y(a.value)} r={4} className="fill-primary stroke-surface" strokeWidth={2} />
            </>
          )}
        </svg>
        {a && active !== null && (
          <div
            role="status"
            className="pointer-events-none absolute top-1 rounded-md border bg-popover px-2 py-1 text-xs shadow-sm"
            style={{ left: `${(x(active) / W) * 100}%`, transform: `translateX(${x(active) > W / 2 ? "calc(-100% - 8px)" : "8px"})` }}
          >
            <span className="block text-muted-foreground">{formatDate(a.periodStart)}</span>
            <span className="font-medium tabular-nums">{fmtValue(a)}</span> / 100
            {partial && active === n - 1 && <span className="block text-warning">ช่วงนี้ยังไม่ครบ</span>}
          </div>
        )}
      </div>
      <figcaption className="mt-1 text-xs text-muted-foreground">
        ความสนใจเทียบกับจุดสูงสุดในไฟล์นี้ (100 = สูงสุด) ไม่ใช่จำนวนการค้นหา
        {partial && " · เส้นจางคือช่วงล่าสุดที่ยังไม่ครบ"}
      </figcaption>
      <details className="mt-2 text-[13px]">
        <summary className="cursor-pointer text-primary">ดูเป็นตาราง</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-md border">
          <table className="w-full text-left">
            <caption className="sr-only">{label} ความสนใจตามช่วงเวลา</caption>
            <thead className="sticky top-0 bg-surface-muted text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 font-medium">ช่วงเริ่ม</th>
                <th className="px-3 py-1.5 text-right font-medium">ความสนใจ</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p, i) => (
                <tr key={p.periodStart} className="border-t">
                  <td className="px-3 py-1">
                    {formatDate(p.periodStart)}
                    {partial && i === n - 1 && <span className="text-xs text-muted-foreground"> (ยังไม่ครบ)</span>}
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums">{fmtValue(p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
