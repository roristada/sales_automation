import type { ConversionStatus } from "./csv";

/**
 * Per-video results and account totals (PLAN.md M7). Commission is only "attributed" to a video
 * when the order carried that publication's tracking code; everything else counts in totals
 * only. Missing data stays null so the UI shows "ไม่มีข้อมูล", not 0.
 */

export interface PubInput {
  id: string;
  projectId: string;
}

export interface MetricInput {
  publicationId: string | null;
  postKey: string;
  capturedOn: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  avgWatchS: number | null;
}

export interface ConversionInput {
  publicationId: string | null;
  status: ConversionStatus;
  commission: number | null;
  orderValue: number | null;
}

export interface Money {
  /** Orders in the report with this status. */
  orders: number;
  commission: number;
}

export interface CommissionSplit {
  completed: Money;
  pending: Money;
  cancelled: Money;
  unknown: Money;
}

export interface PublicationResult {
  latest: (Omit<MetricInput, "publicationId" | "postKey"> & { snapshots: number }) | null;
  commission: CommissionSplit;
  /** Est. spend on renders of this content (all versions). Null when no render was logged. */
  cost: number | null;
  /** Other publications of the same content share this cost. */
  costShared: boolean;
  /** Confirmed commission − cost; null without both. */
  net: number | null;
}

export interface Totals {
  all: CommissionSplit;
  attributed: CommissionSplit;
  unattributed: CommissionSplit;
  /** Sum of the latest view count of each matched post. */
  matchedViews: number | null;
  matchedPosts: number;
  unmatchedPosts: number;
  cost: number;
}

const emptySplit = (): CommissionSplit => ({ completed: { orders: 0, commission: 0 }, pending: { orders: 0, commission: 0 }, cancelled: { orders: 0, commission: 0 }, unknown: { orders: 0, commission: 0 } });
const round = (n: number) => Math.round(n * 100) / 100;

function add(split: CommissionSplit, c: ConversionInput) {
  const m = split[c.status];
  m.orders += 1;
  m.commission = round(m.commission + (c.commission ?? 0));
}

/** Latest snapshot per post (exports are cumulative, so older days are history, not extra views). */
function latestByKey(rows: MetricInput[]) {
  const latest = new Map<string, MetricInput & { snapshots: number }>();
  for (const r of rows) {
    const cur = latest.get(r.postKey);
    if (!cur) latest.set(r.postKey, { ...r, snapshots: 1 });
    else latest.set(r.postKey, r.capturedOn > cur.capturedOn ? { ...r, snapshots: cur.snapshots + 1 } : { ...cur, snapshots: cur.snapshots + 1 });
  }
  return latest;
}

export function summarize(input: { publications: PubInput[]; metrics: MetricInput[]; conversions: ConversionInput[]; projectCosts: Map<string, number> }): { byPublication: Map<string, PublicationResult>; totals: Totals } {
  const perProject = new Map<string, number>();
  for (const p of input.publications) perProject.set(p.projectId, (perProject.get(p.projectId) ?? 0) + 1);

  const byPublication = new Map<string, PublicationResult>();
  for (const p of input.publications) {
    const cost = input.projectCosts.has(p.projectId) ? input.projectCosts.get(p.projectId)! : null;
    byPublication.set(p.id, { latest: null, commission: emptySplit(), cost, costShared: (perProject.get(p.projectId) ?? 0) > 1, net: null });
  }

  const latest = latestByKey(input.metrics);
  let matchedViews: number | null = null;
  let unmatchedPosts = 0;
  for (const m of latest.values()) {
    const target = m.publicationId ? byPublication.get(m.publicationId) : undefined;
    if (!target) {
      unmatchedPosts += 1;
      continue;
    }
    // Two keys (URL and bare ID) can point at one publication: keep the newer snapshot.
    if (!target.latest || m.capturedOn > target.latest.capturedOn) {
      target.latest = { capturedOn: m.capturedOn, views: m.views, likes: m.likes, comments: m.comments, shares: m.shares, saves: m.saves, avgWatchS: m.avgWatchS, snapshots: m.snapshots };
    }
  }
  let matchedPosts = 0;
  for (const r of byPublication.values()) {
    if (r.latest) matchedPosts += 1;
    if (r.latest?.views != null) matchedViews = (matchedViews ?? 0) + r.latest.views;
  }

  const all = emptySplit();
  const attributed = emptySplit();
  const unattributed = emptySplit();
  for (const c of input.conversions) {
    add(all, c);
    const target = c.publicationId ? byPublication.get(c.publicationId) : undefined;
    if (target) {
      add(attributed, c);
      add(target.commission, c);
    } else add(unattributed, c);
  }

  let cost = 0;
  for (const v of input.projectCosts.values()) cost = round(cost + v);
  for (const r of byPublication.values()) {
    const hasOrders = Object.values(r.commission).some((m) => m.orders > 0);
    if (r.cost !== null && hasOrders && !r.costShared) r.net = round(r.commission.completed.commission - r.cost);
  }

  return { byPublication, totals: { all, attributed, unattributed, matchedViews, matchedPosts, unmatchedPosts, cost } };
}
