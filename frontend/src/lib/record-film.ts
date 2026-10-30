/**
 * Records one on-page element (a film: 3D canvas + captions) to a downloadable video, in the browser.
 * Uses tab capture cropped to the element (Chrome Region Capture), so HTML overlays are included.
 * The browser asks the viewer once to share "this tab"; nothing leaves the computer.
 */
type CropTargetCtor = { fromElement(el: Element): Promise<unknown> };
type CroppableTrack = MediaStreamTrack & { cropTo?(t: unknown): Promise<void> };

export interface FilmRecording {
  stop(): void;
  done: Promise<{ blob: Blob; ext: "mp4" | "webm" }>;
}

export function canRecordFilm() {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== "undefined";
}

export async function startFilmRecording(el: HTMLElement): Promise<FilmRecording> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 30, displaySurface: "browser" },
    audio: false,
    // Chrome-only hints: offer the current tab first
    preferCurrentTab: true,
    selfBrowserSurface: "include",
  } as DisplayMediaStreamOptions);
  const track = stream.getVideoTracks()[0] as CroppableTrack;
  const CropTarget = (window as unknown as { CropTarget?: CropTargetCtor }).CropTarget;
  if (CropTarget && track.cropTo) {
    try {
      await track.cropTo(await CropTarget.fromElement(el));
    } catch {
      /* falls back to the whole tab */
    }
  }
  const types = ["video/mp4;codecs=avc1.42E01F", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<{ blob: Blob; ext: "mp4" | "webm" }>((resolve) => {
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const type = rec.mimeType || mimeType || "video/webm";
      resolve({ blob: new Blob(chunks, { type }), ext: type.includes("mp4") ? "mp4" : "webm" });
    };
  });
  track.addEventListener("ended", () => rec.state !== "inactive" && rec.stop()); // user pressed "Stop sharing"
  rec.start(1000);
  return { stop: () => rec.state !== "inactive" && rec.stop(), done };
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "film";
