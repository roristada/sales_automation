/**
 * Real cost per video (AI-6): every OpenRouter call tied to a project's scripts (text, AI clips,
 * voice — the cost OpenRouter reported) plus its renders (estimate from usage events). Calls not
 * tied to a script (e.g. pulling facts for a product) count only in the total.
 */

export type CostGroup = "text" | "clips" | "voice";

export const TASK_GROUP: Record<string, CostGroup> = {
  test: "text",
  script: "text",
  extract: "text",
  scene_prompt: "text",
  review: "text",
  video_product: "clips",
  video_lifestyle: "clips",
  tts: "voice",
};

export interface AiCall {
  storyboardId: string | null;
  task: string;
  costThb: number;
  status: string;
}

export interface VideoCost {
  projectId: string;
  text: number;
  clips: number;
  voice: number;
  render: number;
  total: number;
  calls: number;
  failedCalls: number;
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;

export function videoCosts(calls: AiCall[], projectOf: Map<string, string>, renderByProject: Map<string, number>): { byProject: Map<string, VideoCost>; untied: number } {
  const byProject = new Map<string, VideoCost>();
  const row = (projectId: string) => {
    let r = byProject.get(projectId);
    if (!r) byProject.set(projectId, (r = { projectId, text: 0, clips: 0, voice: 0, render: 0, total: 0, calls: 0, failedCalls: 0 }));
    return r;
  };
  let untied = 0;
  for (const c of calls) {
    const projectId = c.storyboardId ? projectOf.get(c.storyboardId) : undefined;
    if (!projectId) {
      untied += c.costThb;
      continue;
    }
    const r = row(projectId);
    r[TASK_GROUP[c.task] ?? "text"] += c.costThb;
    r.calls++;
    if (c.status === "failed") r.failedCalls++;
  }
  for (const [projectId, thb] of renderByProject) row(projectId).render += thb;
  for (const r of byProject.values()) {
    r.text = round(r.text);
    r.clips = round(r.clips);
    r.voice = round(r.voice);
    r.render = round(r.render);
    r.total = round(r.text + r.clips + r.voice + r.render);
  }
  return { byProject, untied: round(untied) };
}
