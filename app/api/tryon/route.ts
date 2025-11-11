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
  // 🔑 ÖNEMLİ: Vercel Blob için token'ı explicit geçiriyoruz
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN missing on server");
  const { url } = await put(key, file as any, { access: "public", token });
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
    if (res.status !== 401) {
      return { ok: false, res, json, variant };
    }
  }
  const res = new Response(JSON.stringify({ error: "All auth variants 401" }), { status: 401 });
  return { ok: false, res, json: { error: "All auth variants 401" }, variant: "all-401" };
}

// === Eachlabs çıktı URL'ini farklı formatlarda yakala ===
function extractOutputUrls(payload: any): string[] {
  const urls: string[] = [];

  // output: string[] veya {url:string}[]
  if (Array.isArray(payload?.output)) {
    for (const it of payload.output) {
      if (typeof it === "string") urls.push(it);
      else if (it?.url) urls.push(it.url);
    }
  }

  // data.output: string[] veya {url:string}[]
  if (!urls.length && Array.isArray(payload?.data?.output)) {
    for (const it of payload.data.output) {
      if (typeof it === "string") urls.push(it);
      else if (it?.url) urls.push(it.url);
    }
  }

  // output_url (tek) / output_urls (liste)
  if (!urls.length && typeof payload?.output_url === "string") urls.push(payload.output_url);
  if (!urls.length && Array.isArray(payload?.output_urls)) {
    for (const u of payload.output_urls) if (typeof u === "string") urls.push(u);
  }

  // (opsiyonel) bazı modeller base64 döndürebilir
  if (!urls.length && typeof payload?.image_base64 === "string") {
    urls.push(`data:image/jpeg;base64,${payload.image_base64}`);
  }
  if (!urls.length && typeof payload?.data?.image_base64 === "string") {
    urls.push(`data:image/jpeg;base64,${payload.data.image_base64}`);
  }

  return urls;
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
      raw: { Authorization: `${EACHLABS_KEY}`, "X-API-Key": EACHLABS_KEY },
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

    // 4) Çıktı URL'ini normalize et
    const urls = extractOutputUrls(resultData);
    if (!urls.length) {
      console.error("Eachlabs result (no image):", JSON.stringify(resultData, null, 2));
      return NextResponse.json({ error: "No image URL found", raw: resultData }, { status: 500 });
    }

    return NextResponse.json({
      image_url: urls[0],   // geriye dönük kullanım
      urls,                 // tüm alternatifler
      id,
      authVariant: create.variant
    });
  } catch (err: any) {
    console.error("[/api/tryon] error:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
