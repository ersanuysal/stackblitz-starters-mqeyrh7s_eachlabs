// app/api/tryon/route.ts
import { NextResponse } from "next/server";
import { put } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ===== Genel Ayarlar =====
const PROVIDER = (process.env.TRYON_PROVIDER || "eachlabs").toLowerCase();
console.log("TRYON_PROVIDER at runtime:", process.env.TRYON_PROVIDER);
console.log("EACHLABS_KEY exists:", !!process.env.EACHLABS_KEY);

// ===== Yardımcılar =====
async function safeJson(res: Response) {
  try { return await res.json(); } catch { return null; }
}

async function uploadPublicUrl(file: File | Blob, filename = "upload.png") {
  const key = `uploads/${Date.now()}-${filename}`;
  const { url } = await put(key, file as any, { access: "public" });
  return url;
}

type CreatePayload = {
  model: string;
  version: string;
  input: any;
  webhook_url: string;
};

const EACHLABS_URL = "https://api.eachlabs.ai/v1/prediction/";

async function tryCreatePrediction(
  key: string,
  payload: CreatePayload
): Promise<{ ok: boolean; res: Response; json: any; variant: string }> {
  const variants: Array<[string, Record<string, string>]> = [
    ["bearer", { Authorization: `Bearer ${key}`, "X-API-Key": key, "Content-Type": "application/json" }],
    ["api-key", { Authorization: `Api-Key ${key}`, "X-API-Key": key, "Content-Type": "application/json" }],
    ["raw",    { Authorization: key,             "X-API-Key": key, "Content-Type": "application/json" }],
  ];

  for (const [variant, headers] of variants) {
    const res = await fetch(EACHLABS_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const json = await safeJson(res);
    if (res.ok) return { ok: true, res, json, variant };
    // 401 ise sonraki varyanta geç
    if (res.status !== 401) {
      // 401 dışı hata—denemeyi bırak
      return { ok: false, res, json, variant };
    }
  }
  // tüm varyantlar 401
  const res = new Response(JSON.stringify({ error: "All auth variants 401" }), { status: 401 });
  return { ok: false, res, json: { error: "All auth variants 401" }, variant: "all-401" };
}

// ===== Route =====
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const human = form.get("human_image");
    const garment = form.get("garment_image");
    const metaPrompt = String(form.get("meta_prompt") || "");

    if (!(human instanceof File) || !(garment instanceof File)) {
      return NextResponse.json({ error: "Missing files" }, { status: 400 });
    }

    if (PROVIDER !== "eachlabs") {
      return NextResponse.json({ error: `Unknown TRYON_PROVIDER: ${PROVIDER}` }, { status: 400 });
    }

    const EACHLABS_KEY = process.env.EACHLABS_KEY || "";
    if (!EACHLABS_KEY) {
      return NextResponse.json({ error: "EACHLABS_KEY missing" }, { status: 401 });
    }

    // 1) Blob'a yükle
    const [humanUrl, garmentUrl] = await Promise.all([
      uploadPublicUrl(human, (human as any).name || "human.png"),
      uploadPublicUrl(garment, (garment as any).name || "garment.png"),
    ]);

    const prompt =
      metaPrompt?.trim() ||
      "Realistic try-on; keep body pose, true color, clean e-commerce lighting.";

    const payload: CreatePayload = {
      model: "nano-banana-edit",
      version: "0.0.1",
      input: {
        image_urls: [humanUrl, garmentUrl],
        num_images: 1,
        prompt,
        output_format: "jpeg",
        sync_mode: false,
        aspect_ratio: "1:1",
        limit_generations: true,
      },
      webhook_url: "",
    };

    // 2) Prediction oluştur (çoklu auth denemesiyle)
    const create = await tryCreatePrediction(EACHLABS_KEY, payload);

    if (!create.ok || !create.json?.id) {
      console.error("[eachlabs:create] status:", create.res.status, "variant:", create.variant, "json:", create.json);
      return NextResponse.json(
        { error: "Prediction create failed", detail: create.json, authVariant: create.variant },
        { status: create.res.status || 500 }
      );
    }

    const id = create.json.id;

    // 3) Poll
    let resultData: any = null;
    const pollHeadersVariants: Record<string, Record<string, string>> = {
      bearer: { Authorization: `Bearer ${EACHLABS_KEY}`, "X-API-Key": EACHLABS_KEY },
      "api-key": { Authorization: `Api-Key ${EACHLABS_KEY}`, "X-API-Key": EACHLABS_KEY },
      raw: { Authorization: EACHLABS_KEY, "X-API-Key": EACHLABS_KEY },
    };
    const pollHeaders = pollHeadersVariants[create.variant] || pollHeadersVariants["bearer"];

    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const pollRes = await fetch(`${EACHLABS_URL}${id}`, {
        method: "GET",
        headers: pollHeaders,
      });
      const pollJson = await safeJson(pollRes);

      if (!pollRes.ok) {
        // Yetkisiz / diğer hata—hemen döndür
        console.error("[eachlabs:poll] status:", pollRes.status, "json:", pollJson);
        if (pollRes.status === 401) {
          return NextResponse.json(
            { error: "Unauthorized (Eachlabs poll)", detail: pollJson },
            { status: 401 }
          );
        }
      }

      if (pollJson?.status === "succeeded") {
        resultData = pollJson;
        break;
      }
      if (pollJson?.status === "failed") {
        return NextResponse.json({ error: "Prediction failed", detail: pollJson }, { status: 500 });
      }
    }

    if (!resultData) {
      return NextResponse.json({ error: "Prediction timeout or no result" }, { status: 504 });
    }

    const imageUrl =
      resultData?.output?.[0]?.url ||
      resultData?.data?.output?.[0]?.url ||
      null;

    if (!imageUrl) {
      return NextResponse.json({ error: "No image URL found", raw: resultData }, { status: 500 });
    }

    return NextResponse.json({ image_url: imageUrl, id, authVariant: create.variant });
  } catch (err: any) {
    console.error("[/api/tryon] error:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}