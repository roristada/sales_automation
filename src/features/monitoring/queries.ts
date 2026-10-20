import "server-only";

import { statfs } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { storageRoot } from "@/features/video/storage";
import type { Database } from "@/lib/supabase/database.types";
import type { WorkerStatus } from "./status";

type Db = SupabaseClient<Database>;

/** Whether a render worker is alive (heartbeat), or null when the database can't be asked. */
export async function getWorkerStatus(supabase: Db): Promise<WorkerStatus | null> {
  const { data, error } = await supabase.rpc("worker_status");
  const row = data?.[0];
  if (error || !row) return null;
  return { online: row.online, busy: row.busy, lastSeen: row.last_seen };
}

/** The signed-in user's render queue (RLS-scoped). */
export async function getQueueStatus(supabase: Db) {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const count = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then((r) => r.count ?? 0);
  const [queued, processing, failed, oldest] = await Promise.all([
    count(supabase.from("render_jobs").select("id", { count: "exact", head: true }).eq("status", "queued")),
    count(supabase.from("render_jobs").select("id", { count: "exact", head: true }).eq("status", "processing")),
    count(supabase.from("render_jobs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("finished_at", since)),
    supabase.from("render_jobs").select("created_at").eq("status", "queued").order("created_at").limit(1).maybeSingle(),
  ]);
  return { queued, processing, failedLastDay: failed, oldestQueuedAt: oldest.data?.created_at ?? null };
}

/** Free space on the drive holding render outputs and uploads; null if it can't be read. */
export async function getDiskStatus(): Promise<{ root: string; free: number; total: number } | null> {
  // The folder may not exist before the first render: measure the nearest existing parent.
  for (let dir = storageRoot(); ; dir = path.dirname(dir)) {
    try {
      const s = await statfs(dir);
      return { root: storageRoot(), free: s.bavail * s.bsize, total: s.blocks * s.bsize };
    } catch {
      if (path.dirname(dir) === dir) return null;
    }
  }
}
