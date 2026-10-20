"use client";

import { Player } from "@remotion/player";
import { AffiliateVideo } from "@/remotion/AffiliateVideo";
import type { VideoProps } from "./timeline";

/** Live preview of the composition in the browser — same component the worker renders. */
export function VideoPreview({ props }: { props: VideoProps }) {
  return (
    <div className="mx-auto w-full max-w-[360px] overflow-hidden rounded-lg border bg-black">
      <Player
        component={AffiliateVideo}
        inputProps={props}
        durationInFrames={props.durationInFrames}
        fps={props.fps}
        compositionWidth={props.width}
        compositionHeight={props.height}
        style={{ width: "100%", aspectRatio: "9 / 16" }}
        controls
        acknowledgeRemotionLicense
      />
    </div>
  );
}
