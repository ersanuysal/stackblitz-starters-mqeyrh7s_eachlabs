// app/api/video/route.ts
import { NextRequest, NextResponse } from "next/server";
import { fal } from "@fal-ai/client";

// Next.js (Route Handler) config
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// FAL – MiniMax Hailuo-02 Image→Video (768P)
const MODEL_ID = "fal-ai/minimax/hailuo-02/standard/image-to-video";

// API key'i yükle
const FAL_KEY = process.env.FAL_KEY || "";
fal.config({ credentials: FAL_KEY });

// İstek tipi
type VideoBody = {
  prompt: string;
  imageUrl: string;                 // URL veya data:URI
  duration?: "6" | "10" | 6 | 10;   // saniye
  resolution?: "512P" | "768P";
  endImageUrl?: string;             // opsiyonel (bazı sürümlerde destekleniyor)
  promptOptimizer?: boolean;
};

// data:URI → FAL public URL
async function dataUriToFalUrl(dataUrl: string): Promise<string> {
  const [meta, b64] = dataUrl.split(",");
  const mime = /data:(.*?);base64/.exec(meta)?.[1] || "image/png";
  const bin = Buffer.from(b64, "base64");
  // Node runtime olduğumuz için Blob yeterli
  const blob = new Blob([bin], { type: mime }) as any;
  const url = await fal.storage.upload(blob);
  return url;
}

export async function POST(req: NextRequest) {
  try {
    if (!FAL_KEY) {
      return NextResponse.json(
        { error: "FAL_KEY not configured" },
        { status: 500 }
      );
    }

    const body = (await req.json()) as VideoBody;
    const {
      prompt,
      imageUrl,
      endImageUrl,
      promptOptimizer = true,
    } = body;

    const duration = (body.duration ?? "6").toString() as "6" | "10";
    const resolution = (body.resolution ?? "768P") as "512P" | "768P";

    if (!prompt || !imageUrl) {
      return NextResponse.json(
        { error: "Missing prompt or imageUrl" },
        { status: 400 }
      );
    }

    // data:URI geldiyse önce FAL storage'a yükle → public URL elde et
    let image_url = imageUrl;
    if (imageUrl.startsWith("data:")) {
      image_url = await dataUriToFalUrl(imageUrl);
    }

    // Model input'u (end_image_url tiplerde yok; any ile ekliyoruz)
    const input: any = {
      prompt,
      image_url,
      duration,
      resolution,
      prompt_optimizer: promptOptimizer,
    };
    if (endImageUrl) input.end_image_url = endImageUrl;

    // İsteği gönder
    const result = await fal.subscribe(MODEL_ID, { input, logs: false });

    // Sonuçtan güvenle video URL çek
    const data: any = (result as any)?.data ?? {};
    const videoUrl: string | undefined =
      data?.video?.url || data?.result?.video?.url || data?.url;

    if (!videoUrl) {
      return NextResponse.json(
        { error: "Video generation failed", raw: data },
        { status: 500 }
      );
    }

    return NextResponse.json({
      video_url: videoUrl,
      content_type: data?.video?.content_type || "video/mp4",
      description: data?.description,
    });
  } catch (err: any) {
    console.error("[/api/video] error:", err);
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}

// Sağlık kontrolü (404/HTML dönen durumları ayırt etmek için)
export async function GET() {
  return NextResponse.json({ ok: true, route: "video" });
}
