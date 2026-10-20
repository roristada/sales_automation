import { Composition } from "remotion";
import { buildTimeline, type VideoProps, VIDEO } from "@/features/video/timeline";
import { AffiliateVideo } from "./AffiliateVideo";

export const COMPOSITION_ID = "AffiliateVideo";

/** Sample used only by Remotion Studio; real renders pass inputProps from the worker. */
const sample: VideoProps = buildTimeline({
  productName: "ตัวอย่างสินค้า",
  imageSrc: null,
  hook: "ตัวอย่าง Hook",
  cta: "ดูรายละเอียดได้ที่ลิงก์ในคลิป",
  disclosure: "#ได้รับค่าคอมมิชชัน",
  scenes: [{ id: "1", kind: "intro", narration: "นี่คือฉากตัวอย่าง", on_screen_text: "ตัวอย่าง" }],
});

export function RemotionRoot() {
  return (
    <Composition
      id={COMPOSITION_ID}
      component={AffiliateVideo}
      width={VIDEO.width}
      height={VIDEO.height}
      fps={VIDEO.fps}
      durationInFrames={sample.durationInFrames}
      defaultProps={sample}
      calculateMetadata={({ props }) => ({ durationInFrames: props.durationInFrames, fps: props.fps, width: props.width, height: props.height })}
    />
  );
}
