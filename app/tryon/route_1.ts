import { NextRequest, NextResponse } from "next/server";
import { fal } from "@fal-ai/client";

// Next.js App Router server ayarları (Node runtime)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 1) ENV'den oku, 2) StackBlitz için geçici fallback (TESTTEN SONRA KEY'İ ROTATE ET!)
const FAL_KEY =
  process.env.FAL_KEY ||
  ""; // <- çalışmıyorsa şimdilik buraya GEÇİCİ olarak anahtarını yaz, sonra sil ve rotate et.

fal.config({ credentials: FAL_KEY });

type Body = { human_image?: string; garment_image?: string };

export async function POST(req: NextRequest) {
  try {
    const { human_image, garment_image } = (await req.json()) as Body;

    if (!human_image || !garment_image) {
      return NextResponse.json(
        { error: "Missing images: human_image & garment_image required" },
        { status: 400 }
      );
    }

    if (!FAL_KEY) {
      return NextResponse.json(
        { error: "FAL_KEY missing. Set it in .env.local or add temporary fallback in route.ts" },
        { status: 401 }
      );
    }

    const result = await fal.subscribe(
      "fal-ai/kling/v1-5/kolors-virtual-try-on",
      {
        input: {
          human_image_url: human_image,
          garment_image_url: garment_image,
          sync_mode: true,
        },
        logs: true,
      }
    );

    // Bazı sürümlerde result.data.image.url / result.image.url olabilir
    const imageUrl =
      (result as any)?.data?.image?.url ||
      (result as any)?.image?.url ||
      null;

    if (!imageUrl) {
      return NextResponse.json(
        { error: "No image returned from FAL", raw: result },
        { status: 500 }
      );
    }

    return NextResponse.json({ image_url: imageUrl });
  } catch (err: any) {
    console.error("tryon route error:", err?.message || err);
    return NextResponse.json(
      { error: "Server error", detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}
