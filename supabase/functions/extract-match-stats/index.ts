// OfficeFC — `extract-match-stats` Supabase Edge Function (Deno).
//
// AI-assisted match logging: given a photo of an end-of-match stats screen, return
// a normalized, human-reviewable suggestion (score + key stats). This NEVER submits
// or confirms a match — it only pre-fills the log form. The opponent-confirmation
// step remains the source of truth.
//
// Deploy:
//   supabase functions deploy extract-match-stats
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   # + optional ANTHROPIC_MODEL
//
// @ts-nocheck  (Deno runtime globals; the testable logic lives in ./core/*.mjs and
//               is covered by the Node tests in /test.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractMatchFromImage } from "./core/extract.mjs";
import { DEFAULT_MODEL } from "./core/schema.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

function mediaTypeFromPath(path: string): string {
  const ext = (path.split(".").pop() || "").toLowerCase();
  return ext === "jpg" || ext === "jpeg"
    ? "image/jpeg"
    : ext === "webp"
    ? "image/webp"
    : ext === "gif"
    ? "image/gif"
    : "image/png";
}

const toBase64 = (bytes: Uint8Array): string => {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "server_misconfigured", detail: "ANTHROPIC_API_KEY not set" }, 500);

  // --- auth: require a signed-in league member; the user's JWT enforces RLS ---
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  // --- input: a private-bucket storage path, or an inline base64 image ---
  let payload: { photoPath?: string; bucket?: string; imageBase64?: string; mediaType?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "bad_request", detail: "invalid JSON body" }, 400);
  }

  let imageBase64 = payload.imageBase64;
  let mediaType = payload.mediaType || "image/png";

  if (!imageBase64 && payload.photoPath) {
    const bucket = payload.bucket || "match-photos";
    // RLS on storage.objects governs whether this user may read the file.
    const { data: file, error: dlErr } = await supabase.storage.from(bucket).download(payload.photoPath);
    if (dlErr || !file) return json({ error: "photo_not_found", detail: dlErr?.message }, 404);
    imageBase64 = toBase64(new Uint8Array(await file.arrayBuffer()));
    mediaType = mediaTypeFromPath(payload.photoPath);
  }
  if (!imageBase64) return json({ error: "bad_request", detail: "provide photoPath or imageBase64" }, 400);

  // --- extract ---
  try {
    const result = await extractMatchFromImage({
      imageBase64,
      mediaType,
      model: Deno.env.get("ANTHROPIC_MODEL") || DEFAULT_MODEL,
      apiKey,
      baseUrl: Deno.env.get("ANTHROPIC_BASE_URL") || undefined,
    });
    // The app pre-fills the log form from `result.suggestion`, lets the user pick the
    // opponent + which side was theirs, and shows review flags. Persisting the raw
    // extraction onto match_photos.extracted_json happens after the match row exists.
    return json(result);
  } catch (e) {
    return json({ error: "extraction_failed", detail: String(e?.message || e) }, 502);
  }
});
