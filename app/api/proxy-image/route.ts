
// app/api/proxy-image/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const u = searchParams.get("u");
    if (!u) return NextResponse.json({ error: "Missing ?u=" }, { status: 400 });

    // Uzak görseli sunucu tarafında al
    const res = await fetch(u, { cache: "no-store" });

    if (!res.ok || !res.body) {
      return NextResponse.json({ error: "Upstream fetch failed" }, { status: 502 });
    }

    // İçerik türünü ve temel CORS'u ayarla (canvas için güvenli)
    const ct = res.headers.get("content-type") || "image/png";
    const headers = new Headers({
      "Content-Type": ct,
      "Cache-Control": "public, max-age=60",
      // Canvas okumasını engellememesi için en güvenlisi:
      "Access-Control-Allow-Origin": "*",
    });

    return new Response(res.body, { status: 200, headers });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "proxy error" }, { status: 500 });
  }
}
