// app/api/removebg/route.ts
import { NextRequest, NextResponse } from "next/server";

// ——— Next.js runtime ayarları ———
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

// ——— API açıklaması ———
// Bu sürüm artık FAL_KEY gerektirmez.
// Görseli olduğu gibi geri döndürür, böylece sistem hata vermez.
// Dilersen buraya Eachlabs’in kendi background removal endpointini entegre edebilirsin.

type RemoveBgBody = {
  image: string; // URL veya data:URI (base64)
};

export async function POST(req: NextRequest) {
  try {
    const { image } = (await req.json()) as RemoveBgBody;

    if (!image || typeof image !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid `image`" },
        { status: 400 }
      );
    }

    // Şimdilik sadece pasif mod: gelen görseli aynen döndür
    return NextResponse.json({
      image_url: image,
      description:
        "Passthrough mode: background removal disabled for Eachlabs setup.",
    });
  } catch (err: any) {
    console.error("[/api/removebg] error:", err);
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}