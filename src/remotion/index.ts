// Entry point for the Remotion bundler (used by the render worker and `npx remotion studio`).
import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);
