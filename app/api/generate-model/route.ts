// app/api/generate-model/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Eachlabs tabanlı “model generate” endpointi.
 * FAL bağımlılığı yok. Eachlabs Prediction API'yi kullanır (polling ile).
 *
 * Gerekli ENV:
 *   - EACHLABS_KEY
 */

const EACHLABS_URL = "https://api.eachlabs.ai/v1/prediction/";

type Body = {
  ethnicity: string; // ör: "mediterranean", "asian", "black", "white", "latina", "middle eastern", "indian" ...
  gender: string;    // "female" | "male" | "non-binary" ...
  style?: "studio" | "street" | "runway" | "catalog";
  aspect_ratio?: "1:1" | "3:4" | "4:5" | "9:16" | "16:9";
};

const STYLE_PROMPTS = {
  studio:
    "clean studio lighting, seamless light background, soft key light and gentle fill, photostudio look",
  street:
    "street fashion vibe, natural daylight, shallow depth of field, modern city backdrop, editorial feel",
  runway:
    "runway ambience, spotlight, glossy floor reflections, fashion show atmosphere",
  catalog:
    "plain light background, evenly lit, e-commerce catalog style, neutral stance",
} as const;

function buildPrompt(gender: string, ethnicity: string, style: keyof typeof STYLE_PROMPTS) {
  const base =
    `Full-body fashion model, ${gender.toLowerCase()}, ${ethnicity.toLowerCase()} appearance. ` +
    `${STYLE_PROMPTS[style]}. Neutral pose, arms relaxed, photorealistic, realistic human proportions, high detail skin and hair, natural hands. ` +
    `True-to-life colors, balanced exposure, high resolution.`;
  return base;
}

export async function POST(req: NextRequest) {
  try {
    const EACHLABS_KEY = process.env.EACHLABS_KEY || "";
    if (!EACHLABS_KEY) {
      return NextResponse.json({ error: "EACHLABS_KEY missing" }, { status: 401 });
    }

    const {
      ethnicity,
      gender,
      style = "studio",
      aspect_ratio = "3:4",
    } = (await req.json()) as Body;

    if (!ethnicity || !gender) {
      return NextResponse.json({ error: "Missing ethnicity or gender" }, { status: 400 });
    }

    const styleKey: keyof typeof STYLE_PROMPTS =
      (["studio", "street", "runway", "catalog"] as const).includes(style as any)
        ? (style as keyof typeof STYLE_PROMPTS)
        : "studio";

    const prompt = buildPrompt(gender, ethnicity, styleKey);

    // 1) Prediction oluştur
    const createRes = await fetch(EACHLABS_URL, {
      method: "POST",
      headers: {
        "X-API-Key": EACHLABS_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Not: Eachlabs tarafında pure text-to-image için "nano-banana" modeli kullanılabilir.
        model: "nano-banana",
        version: "0.0.1",
        input: {
          prompt,
          num_images: 1,
          output_format: "png",
          sync_mode: false,       // polling ile bekleyeceğiz
          aspect_ratio,           // ör: "3:4"
          limit_generations: true // kredi kontrolü
        },
        webhook_url: "",
      }),
    });

    const createData = await createRes.json();
    if (!createRes.ok || !createData?.id) {
      return NextResponse.json(
        { error: "Prediction create failed", detail: createData },
        { status: createRes.status || 500 }
      );
    }

    const id = createData.id;

    // 2) Poll ile sonucu bekle
    let resultData: any = null;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const pollRes = await fetch(`${EACHLABS_URL}${id}`, {
        method: "GET",
        headers: { "X-API-Key": EACHLABS_KEY },
      });
      const pollJson = await pollRes.json();

      if (pollJson?.status === "succeeded") {
        resultData = pollJson;
        break;
      }
      if (pollJson?.status === "failed") {
        return NextResponse.json(
          { error: "Prediction failed", detail: pollJson },
          { status: 500 }
        );
      }
    }

    if (!resultData) {
      return NextResponse.json(
        { error: "Prediction timeout or no result" },
        { status: 504 }
      );
    }

    const imageUrl: string | null =
      resultData?.output?.[0]?.url || resultData?.data?.output?.[0]?.url || null;

    if (!imageUrl) {
      return NextResponse.json(
        { error: "No image URL found", raw: resultData },
        { status: 500 }
      );
    }

    return NextResponse.json({ image_url: imageUrl, id });
  } catch (err: any) {
    console.error("[/api/generate-model] error:", err);
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}