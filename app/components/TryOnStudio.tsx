"use client";
import React, { useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Upload, Image as ImageIcon, Play, Sparkles, Save, Trash2,
  Loader2, ChevronRight, Download, LogIn, Film, Video as VideoIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";

/* ————————————————————— Helpers ————————————————————— */
async function cropTransparent(src: string, alphaThreshold = 4): Promise<string> {
  const img = new Image(); img.crossOrigin = "anonymous"; img.src = src;
  await new Promise((r, j) => { img.onload = () => r(null); img.onerror = j; });
  const c = document.createElement("canvas");
  const x = c.getContext("2d", { willReadFrequently: true })!;
  c.width = img.width; c.height = img.height;
  x.drawImage(img, 0, 0);
  const { data, width, height } = x.getImageData(0, 0, c.width, c.height);

  let top = 0, bottom = height - 1, left = 0, right = width - 1;
  const rowHas = (y:number)=>{const i0=y*width*4;for(let i=i0+3;i<i0+width*4;i+=4)if(data[i]>alphaThreshold)return true;return false;};
  const colHas = (cx:number)=>{for(let y=0;y<height;y++){const i=(y*width+cx)*4+3;if(data[i]>alphaThreshold)return true;}return false;};
  while(top<bottom&&!rowHas(top))top++; while(bottom>top&&!rowHas(bottom))bottom--;
  while(left<right&&!colHas(left))left++; while(right>left&&!colHas(right))right--;
  const w=Math.max(1,right-left+1), h=Math.max(1,bottom-top+1);

  const o=document.createElement("canvas"); const ox=o.getContext("2d")!;
  o.width=w; o.height=h; ox.drawImage(c,left,top,w,h,0,0,w,h);
  return o.toDataURL("image/png");
}
function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(",");
  const mime = /data:(.*?);base64/.exec(meta)?.[1] || "image/png";
  const bin = atob(b64);
  const len = bin.length;
  const u8 = new Uint8Array(len);
  for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: mime });
}

/** JSON-first fetch helper (metin/HTML gelirse kısa mesaja düşer) */
/** JSON-first fetch helper (tek seferde text okuyup JSON’a parse eder) */
async function fetchJSONSafe(input: RequestInfo | URL, init?: RequestInit) {
  const resp = await fetch(input, init);

  // Gövdeyi sadece 1 kez oku
  const raw = await resp.text();

  // JSON’a çevirmeye çalış
  let payload: any = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    // JSON değilse kısaltılmış metin üret
    const brief = (raw || "").replace(/\s+/g, " ").slice(0, 280);
    if (!resp.ok) throw new Error(brief || `HTTP ${resp.status}`);
    // OK döndü ama JSON değilse:
    throw new Error("Unexpected non-JSON response");
  }

  // HTTP hata ise payload içinden mesaj al
  if (!resp.ok) {
    throw new Error(payload?.error || payload?.message || `HTTP ${resp.status}`);
  }
  return payload;
}

/** FormData POST’u yapan ve JSON-first davranan helper */
async function postFormDataJSONSafe(url: string, fd: FormData) {
  return fetchJSONSafe(url, {
    method: "POST",
    headers: { Accept: "application/json" }, // JSON beklediğimizi belirt
    body: fd,
  });
}
/* ———————————————————————————————————————————————————— */

type SceneStyle = "studio" | "street" | "runway" | "catalog";
type HumanSource = "uploaded" | "generated";
type VideoDuration = "6" | "10";
type VideoResolution = "512P" | "768P";

const TRYON_ENDPOINT = process.env.NEXT_PUBLIC_TRYON_ENDPOINT || "/api/tryon";
const VIDEO_ENDPOINT = process.env.NEXT_PUBLIC_VIDEO_ENDPOINT || "/api/video";

export default function TryOnStudio() {
  /* Uploaded user / garment / result */
  const [userImage, setUserImage] = useState<string | null>(null);
  const [garmentImage, setGarmentImage] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  /* Generated model */
  const [generatedModelUrl, setGeneratedModelUrl] = useState<string | null>(null);
  const [isGenLoading, setIsGenLoading] = useState(false);

  /* Controls */
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [fitStrength, setFitStrength] = useState(70);
  const [keepBody, setKeepBody] = useState(true);
  const [size, setSize] = useState("M");
  const [sceneStyle, setSceneStyle] = useState<SceneStyle>("studio");
  const [autoRemoveBg, setAutoRemoveBg] = useState(true);
  const [humanSource, setHumanSource] = useState<HumanSource>("uploaded");

  /* Video controls */
  const [videoDuration, setVideoDuration] = useState<VideoDuration>("6");
  const [videoResolution, setVideoResolution] = useState<VideoResolution>("768P");
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  /* Model generator form */
  const [genEthnicity, setGenEthnicity] = useState("Latina");
  const [genGender, setGenGender] = useState("Female");
  const [genStyle, setGenStyle] = useState<SceneStyle>("studio");

  /* Optional prompt (debug/gelecek) */
  const [editPrompt, setEditPrompt] = useState(
    "Dress the model with the garment realistically; preserve body and pose; keep lighting consistent; e-commerce look."
  );

  const userFileRef = useRef<HTMLInputElement | null>(null);
  const garmentFileRef = useRef<HTMLInputElement | null>(null);

  /* Upload helpers */
  function readFileToDataUrl(file: File) {
    return new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }
  async function removeBackground(dataUrlOrUrl: string): Promise<string> {
    try {
      const data = await fetchJSONSafe("/api/removebg", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ image: dataUrlOrUrl }),
      });
      return data.image_url || data.url || data.dataUrl || data;
    } catch {
      return dataUrlOrUrl;
    }
  }
  async function onPickUser(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    const url = await readFileToDataUrl(f);
    const processed = autoRemoveBg ? await removeBackground(url) : url;
    setUserImage(processed);
    setHumanSource("uploaded");
    setPreview(null);
    setVideoUrl(null);
  }
  async function onPickGarment(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    const url = await readFileToDataUrl(f);
    const processed = autoRemoveBg ? await removeBackground(url) : url;
    setGarmentImage(processed);
    setVideoUrl(null);
  }

  /* Style prompt pieces */
  const stylePrompts: Record<SceneStyle, string> = {
    studio: "Clean studio lighting, seamless background.",
    street: "Street fashion vibe, natural daylight, shallow DOF.",
    runway: "Runway atmosphere, spotlight, glossy floor.",
    catalog: "Plain light background, even lighting, catalog look.",
  };
  const finalPrompt =
    `${editPrompt} ${stylePrompts[sceneStyle]} ` +
    `Fit strength: ${fitStrength}/100. ` +
    `${keepBody ? "Keep original body and pose." : ""}`.trim();

  /* Generate model (AI manken) */
  async function handleGenerateModel() {
    setIsGenLoading(true);
    setGeneratedModelUrl(null);
    setVideoUrl(null);
    try {
      const { image_url } = await fetchJSONSafe("/api/generate-model", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ethnicity: genEthnicity, gender: genGender, style: genStyle }),
      });
      setGeneratedModelUrl(image_url);
      setHumanSource("generated");
    } catch (e: any) {
      console.error(e);
      alert("Model üretilemedi: " + (e?.message || e));
    } finally {
      setIsGenLoading(false);
    }
  }

  /* Try-on (FormData ile) */
  async function handleRun() {
    const humanToUse = humanSource === "generated" ? generatedModelUrl : userImage;
    if (!humanToUse || !garmentImage) return;

    setIsLoading(true);
    setPreview(null);
    setVideoUrl(null);

    const toBlob = async (src: string) => {
      if (src.startsWith("data:")) {
        const [meta, b64] = src.split(",");
        const mime = /data:(.*?);base64/.exec(meta)?.[1] || "image/png";
        const bin = atob(b64);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return new Blob([u8], { type: mime });
      }
      const r = await fetch(src);
      return await r.blob();
    };

    try {
      const fd = new FormData();
      fd.append("human_image", await toBlob(humanToUse));
      fd.append("garment_image", await toBlob(garmentImage));
      fd.append("meta_prompt", finalPrompt);

      const { image_url } = await postFormDataJSONSafe(TRYON_ENDPOINT, fd);
      if (!image_url) throw new Error("No image in response");

      try {
        const cropped = await cropTransparent(image_url);
        setPreview(cropped || image_url);
      } catch {
        setPreview(image_url);
      }
    } catch (e: any) {
      console.error(e);
      alert("Try-on başarısız: " + (e?.message || e));
    } finally {
      setIsLoading(false);
    }
  }

  /* Video: Image → Video (FAL MiniMax Hailuo-02) */
  async function handleGenerateVideo() {
    const baseImage = preview || (humanSource === "generated" ? generatedModelUrl : userImage);
    if (!baseImage) return;

    setIsVideoLoading(true);
    setVideoUrl(null);

    try {
      const prompt =
        `Short fashion showcase motion. ${stylePrompts[sceneStyle]} Keep identity and garment consistent; natural movement; cinematic feel.`;

      const payload = await fetchJSONSafe(VIDEO_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          prompt,
          imageUrl: baseImage,
          duration: videoDuration,
          resolution: videoResolution,
          promptOptimizer: true,
        }),
      });

      const video_url: string | undefined = payload?.video_url || payload?.url;
      if (!video_url) throw new Error("No video url in response");
      setVideoUrl(video_url);
    } catch (e: any) {
      console.error(e);
      alert("Video oluşturma başarısız: " + (e?.message || e));
    } finally {
      setIsVideoLoading(false);
    }
  }

  async function downloadPreview() {
    if (!preview) return;
    try {
      setIsDownloading(true);
      let blob: Blob;
      if (preview.startsWith("data:")) {
        blob = dataUrlToBlob(preview);
      } else {
        const res = await fetch(preview, { mode: "cors" });
        const arr = await res.arrayBuffer();
        blob = new Blob([arr], { type: res.headers.get("content-type") || "image/png" });
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "tryon-result.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("download failed", e);
    } finally {
      setIsDownloading(false);
    }
  }

  async function downloadVideo() {
    if (!videoUrl) return;
    try {
      const res = await fetch(videoUrl, { mode: "cors" });
      const buf = await res.arrayBuffer();
      const blob = new Blob([buf], { type: res.headers.get("content-type") || "video/mp4" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "tryon-video.mp4";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("video download failed", e);
    }
  }

  function resetAll() {
    setUserImage(null);
    setGeneratedModelUrl(null);
    setGarmentImage(null);
    setPreview(null);
    setHumanSource("uploaded");
    setIsLoading(false);
    setVideoUrl(null);
  }

  /* Background (uploaded user) */
  const bgStyle = userImage
    ? { backgroundImage: `url(${userImage})`, backgroundSize: "cover", backgroundPosition: "center" as const }
    : undefined;

  const hasBaseForVideo = !!(preview || generatedModelUrl || userImage);

  return (
    <div className="min-h-screen relative text-white">
      {/* BG */}
      <div className="absolute inset-0 -z-10" style={bgStyle}>
        <div className="absolute inset-0 bg-black/45" />
      </div>

      {/* Top bar */}
      <div className="sticky top-0 z-40 border-b border-white/10 bg-black/30 backdrop-blur supports-[backdrop-filter]:bg-black/20">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-xl bg-white text-black font-bold">T</div>
            <span className="font-semibold tracking-tight">Try-On Studio</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={downloadPreview} disabled={!preview || isDownloading}>
              {isDownloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerateVideo}
              disabled={!hasBaseForVideo || isVideoLoading}
              title={hasBaseForVideo ? "Generate short video" : "Upload/Generate an image first"}
            >
              {isVideoLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Film className="mr-2 h-4 w-4" />}
              Make Video
            </Button>
            <Button variant="outline" size="sm" className="hidden sm:inline-flex">
              <LogIn className="mr-2 h-4 w-4" />Log in
            </Button>
            <Button onClick={handleRun} disabled={isLoading || !garmentImage || (humanSource==="uploaded" ? !userImage : !generatedModelUrl)}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Generate
            </Button>
          </div>
        </div>
      </div>

      {/* Layout */}
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 px-4 py-6 lg:grid-cols-12">
        {/* LEFT COLUMN */}
        {/* LEFT COLUMN */}
        <div className="lg:col-span-4 space-y-4 lg:h-[calc(100vh-64px)] lg:overflow-y-auto lg:pr-2">

          {/* Upload & Settings */}
          <Card className="bg-black/70 border-white/10 text-white backdrop-blur">
            <CardHeader><CardTitle className="text-base">Upload & Settings</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              {/* Human source */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[10px] uppercase text-white/70">Human source</Label>
                  <Select value={humanSource} onValueChange={(v)=>setHumanSource(v as HumanSource)}>
                    <SelectTrigger className="mt-1 bg-white text-black"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="uploaded">Uploaded</SelectItem>
                      <SelectItem value="generated">Generated</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px] uppercase text-white/70">Scene style</Label>
                  <Select value={sceneStyle} onValueChange={(v)=>setSceneStyle(v as SceneStyle)}>
                    <SelectTrigger className="mt-1 bg-white text-black"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="studio">Clean studio</SelectItem>
                      <SelectItem value="street">Street</SelectItem>
                      <SelectItem value="runway">Runway</SelectItem>
                      <SelectItem value="catalog">E-commerce</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* User photo */}
              <div className="space-y-2">
                <Label className="text-[10px] uppercase text-white/70">User photo</Label>
                <div className="flex items-center gap-2">
                  <Input ref={userFileRef} type="file" accept="image/*" onChange={onPickUser} className="bg-white text-black" />
                  <Button variant="secondary" onClick={() => userFileRef.current?.click()} size="icon">
                    <Upload className="h-4 w-4" />
                  </Button>
                </div>
                {userImage && (
                  <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-black/30">
                    <img src={userImage} alt="user" className="h-36 w-full object-contain" />
                  </div>
                )}
              </div>

              {/* Garment */}
              <div className="space-y-2">
                <Label className="text-[10px] uppercase text-white/70">Garment image</Label>
                <div className="flex items-center gap-2">
                  <Input ref={garmentFileRef} type="file" accept="image/*" onChange={onPickGarment} className="bg-white text-black" />
                  <Button variant="secondary" onClick={() => garmentFileRef.current?.click()} size="icon">
                    <ImageIcon className="h-4 w-4" />
                  </Button>
                </div>
                {garmentImage && (
                  <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-black/30">
                    <img src={garmentImage} alt="garment" className="h-36 w-full object-contain" />
                  </div>
                )}
              </div>

              {/* Prompt */}
              <div className="space-y-2">
                <Label className="text-[10px] uppercase text-white/70">Edit prompt</Label>
                <Input
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  placeholder="Describe how to edit…"
                  className="bg-white text-black"
                />
                <p className="text-xs text-white/60">
                  İpucu: İngilizce net yönergeler en iyi sonucu verir.
                </p>
              </div>

              {/* Toggles */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-[10px] uppercase text-white/70">Auto remove-bg</Label>
                  <Switch checked={autoRemoveBg} onCheckedChange={setAutoRemoveBg} />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-[10px] uppercase text-white/70">Keep body</Label>
                  <Switch checked={keepBody} onCheckedChange={setKeepBody} />
                </div>
                <div>
                  <Label className="text-[10px] uppercase text-white/70">Fit strength</Label>
                  <div className="pt-2">
                    <Slider value={[fitStrength]} onValueChange={(v) => setFitStrength(v[0])} max={100} step={1} />
                    <div className="mt-1 text-right text-xs text-white/60">{fitStrength}%</div>
                  </div>
                </div>
                
              </div>

              {/* Video Settings */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div>
                  <Label className="text-[10px] uppercase text-white/70">Video duration</Label>
                  <Select value={videoDuration} onValueChange={(v)=>setVideoDuration(v as VideoDuration)}>
                    <SelectTrigger className="mt-1 bg-white text-black"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="6">6s</SelectItem>
                      <SelectItem value="10">10s</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px] uppercase text-white/70">Resolution</Label>
                  <Select value={videoResolution} onValueChange={(v)=>setVideoResolution(v as VideoResolution)}>
                    <SelectTrigger className="mt-1 bg-white text-black"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="512P">512P</SelectItem>
                      <SelectItem value="768P">768P</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <Button variant="outline" onClick={resetAll} className="w-full bg-transparent text-white border-white/20">
                  <Trash2 className="mr-2 h-4 w-4" />Reset
                </Button>
                <Button onClick={handleRun} disabled={isLoading || !garmentImage || (humanSource==="uploaded" ? !userImage : !generatedModelUrl)} className="w-full">
                  {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  Generate
                </Button>
              </div>

              <Button
                variant="secondary"
                className="w-full"
                onClick={handleGenerateVideo}
                disabled={!hasBaseForVideo || isVideoLoading}
                title={hasBaseForVideo ? "Generate short fashion video" : "Önce görsel üret/yükle"}
              >
                {isVideoLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <VideoIcon className="mr-2 h-4 w-4" />}
                Make Video
              </Button>
            </CardContent>
          </Card>

          {/* Model Generator (AYRI KART) */}
          <Card className="bg-black/70 border-white/10 text-white backdrop-blur">
            <CardHeader><CardTitle className="text-base">Model Generator (AI mannequin)</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[10px] uppercase text-white/70">Ethnicity</Label>
                  <Select value={genEthnicity} onValueChange={setGenEthnicity}>
                    <SelectTrigger className="mt-1 bg-white text-black"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["Latina","Black","White","South Asian","East Asian","Middle Eastern","Mixed"].map(e => (
                        <SelectItem key={e} value={e}>{e}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px] uppercase text-white/70">Gender</Label>
                  <Select value={genGender} onValueChange={setGenGender}>
                    <SelectTrigger className="mt-1 bg-white text-black"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["Female","Male","Non-binary"].map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label className="text-[10px] uppercase text-white/70">Model style</Label>
                  <Select value={genStyle} onValueChange={(v)=>setGenStyle(v as SceneStyle)}>
                    <SelectTrigger className="mt-1 bg-white text-black"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="studio">Studio</SelectItem>
                      <SelectItem value="street">Street</SelectItem>
                      <SelectItem value="runway">Runway</SelectItem>
                      <SelectItem value="catalog">Catalog</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <Button variant="secondary" onClick={handleGenerateModel} disabled={isGenLoading} className="w-full">
                  {isGenLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  Generate Model
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={!generatedModelUrl}
                  onClick={()=>setHumanSource("generated")}
                  title="Use generated model for try-on"
                >
                  Use for Try-On
                </Button>
              </div>

              {generatedModelUrl && (
                <div className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
                  <img src={generatedModelUrl} alt="generated model" className="w-full h-64 object-contain" />
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* CENTER / RIGHT */}
        {/* CENTER / RIGHT */}
        <div className="lg:col-span-8 lg:sticky lg:top-16 self-start">

          <Card className="bg-black/30 border-white/10 backdrop-blur overflow-hidden">
            <CardContent className="p-6">
              {!userImage && !generatedModelUrl && !preview && (
                <div className="grid h-[70vh] place-items-center text-white/80">
                  <div className="text-center">
                    <ChevronRight className="mx-auto mb-3 h-6 w-6" />
                    <p>Soldan bir kullanıcı görseli yükleyin ya da alttaki <b>Model Generator</b> ile bir manken üretin; ürünü yükleyip <b>Generate</b>’e basın.</p>
                  </div>
                </div>
              )}

              {(userImage || generatedModelUrl) && !preview && (
                <div className="grid h-[70vh] place-items-center">
                  <img
                    src={humanSource === "generated" ? (generatedModelUrl || "") : (userImage || "")}
                    className="max-h-[68vh] w-auto object-contain rounded-xl [filter:drop-shadow(0_18px_28px_rgba(0,0,0,0.35))]"
                  />
                </div>
              )}

              {preview && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mx-auto grid max-w-5xl grid-cols-1 gap-6 md:grid-cols-2"
                >
                  <div className="rounded-xl bg-black/20 p-3">
                    <div className="mb-2 text-xs uppercase tracking-wide text-white/60">Original</div>
                    <img
                      src={humanSource === "generated" ? (generatedModelUrl || "") : (userImage || "")}
                      className="mx-auto max-h-[64vh] w-auto object-contain rounded-lg [filter:drop-shadow(0_18px_28px_rgba(0,0,0,0.35))]"
                    />
                  </div>
                  <div className="rounded-xl bg-black/20 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs uppercase tracking-wide text-white/60">Result</span>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={downloadPreview}
                          disabled={!preview || isDownloading}
                          className="h-7 px-2"
                          title="Download result"
                        >
                          {isDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleGenerateVideo}
                          disabled={isVideoLoading}
                          className="h-7 px-2"
                          title="Make video from this result"
                        >
                          {isVideoLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Film className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </div>
                    <img
                      src={preview}
                      className="mx-auto max-h-[64vh] w-auto object-contain rounded-lg [filter:drop-shadow(0_18px_28px_rgba(0,0,0,0.35))]"
                    />
                  </div>
                </motion.div>
              )}

              {/* Video output */}
              {videoUrl && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-6 rounded-xl bg-black/20 p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-white/60">Video</span>
                    <Button size="sm" variant="secondary" onClick={downloadVideo} className="h-7 px-2">
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <video
                    src={videoUrl}
                    controls
                    className="mx-auto w-full max-h-[64vh] rounded-lg"
                  />
                </motion.div>
              )}

              {(isLoading || isVideoLoading) && (
                <div className="absolute inset-0 grid place-items-center bg-black/30">
                  <Loader2 className="h-7 w-7 animate-spin text-white" />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

     
    </div>
  );
}
