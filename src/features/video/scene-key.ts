/** Remounts a scene's visual form when its saved plan changes (so the form shows what was saved). */
export const sceneKey = (s: { id: string; plan: { mode: string; video_task: string; prompt: string; duration_s: number; transition: string; model: string | null } }) =>
  `${s.id}-${s.plan.mode}-${s.plan.video_task}-${s.plan.prompt.length}-${s.plan.duration_s}-${s.plan.transition}-${s.plan.model ?? ""}`;
