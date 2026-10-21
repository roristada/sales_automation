import { describe, expect, it } from "vitest";
import { hexColor, imageDemuxer, portraitFrame } from "./frame";

describe("first frame for AI clips", () => {
  it("reads the image format from its magic bytes and refuses anything else (e.g. a playlist)", async () => {
    expect(imageDemuxer(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe("jpeg_pipe");
    expect(imageDemuxer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("png_pipe");
    expect(imageDemuxer(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1"))).toBe("webp_pipe");
    const playlist = Buffer.from("#EXTM3U\n#EXTINF:1,\nfile:///etc/passwd\n");
    expect(() => imageDemuxer(playlist)).toThrow(/ไม่ใช่ JPG, PNG หรือ WebP/);
    await expect(portraitFrame(playlist)).rejects.toThrow(/ไม่ใช่ JPG, PNG หรือ WebP/);
    expect(hexColor([255, 8, 0])).toBe("0xff0800");
  });
});
