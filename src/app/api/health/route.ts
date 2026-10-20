import { createClient } from "@supabase/supabase-js";
import { getWorkerStatus } from "@/features/monitoring/queries";
import { workerState } from "@/features/monitoring/status";
import { getSupabasePublicEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

/*
 * For an uptime monitor (docs/DEPLOY.md). Public, so it says only up/down: 200 when the app and
 * database answer, 503 otherwise. `worker` is reported but doesn't fail the check unless
 * ?worker=required — rendering is optional while you only plan or publish.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const env = getSupabasePublicEnv();
  const worker = env ? workerState(await getWorkerStatus(createClient<Database>(env.url, env.anonKey, { auth: { persistSession: false } }))) : "unknown";
  const db = worker === "unknown" ? "down" : "up";
  const workerUp = worker === "online" || worker === "busy";
  const requireWorker = new URL(request.url).searchParams.get("worker") === "required";
  const ok = db === "up" && (workerUp || !requireWorker);
  return Response.json(
    { status: ok ? "ok" : "down", db, worker: workerUp ? "online" : worker === "unknown" ? "unknown" : "offline" },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
