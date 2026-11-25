// Felles oppskrifter for webappen (Netlify Blobs).
//  GET  /api/recipes                 -> { docs }  publiserte nye/endrede oppskrifter (alle kan lese)
//  POST /api/recipes {action:"submit", recipe, from}         -> venners oppskrift til Mortens innboks
//  POST /api/recipes {action:"inbox"|"approve"|"reject"|"set"|"delete", token, ...}  -> bare Morten (eierkoden)
import { getStore } from "@netlify/blobs";
import { createHash, randomBytes } from "node:crypto";

// SHA-256 av eierkoden. Selve koden ligger aldri i koden.
const EIERHASH = "14dacdf1dfad279c87050573c72e318f1e76380331d1001b17bf2cb412833379";
const SUBMIT_PER_HOUR = 8;
const MAX_BODY = 4_000_000;
const hits = new Map();

const store = (name) => getStore({ name, consistency: "strong" });
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const isOwner = (tok) => typeof tok === "string" && tok.length > 8 && createHash("sha256").update(tok).digest("hex") === EIERHASH;
const newId = (p) => p + Date.now().toString(36) + randomBytes(3).toString("hex");
const str = (v, n) => String(v == null ? "" : v).slice(0, n);

async function readAll() { return (await store("recipes").get("all", { type: "json" })) || { docs: {} }; }
async function writeAll(all) { await store("recipes").setJSON("all", all); }

// Bilder sendt som data-URL lagres i bildelageret og erstattes med en adresse.
async function keepImage(img) {
  if (typeof img !== "string" || !img) return "";
  const m = img.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) return /^(\/|https:\/\/)/.test(img) ? str(img, 400) : "";
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 2_500_000) return "";
  const key = newId("i");
  await store("images").set(key, buf, { metadata: { type: m[1] } });
  return "/api/img/" + key;
}

function cleanList(arr, n) {
  return (Array.isArray(arr) ? arr : []).slice(0, n).map((x) => {
    if (Array.isArray(x)) return { k: x[0] === "H" ? "H" : x[0] === "S" ? "S" : "I", t: str(x[1], 600) };
    return { k: x && (x.k === "H" || x.k === "S") ? x.k : "I", t: str(x && x.t, 600) };
  }).filter((x) => x.t);
}
async function cleanRecipe(r, { stepsK = "S" } = {}) {
  r = r || {};
  const steps = cleanList(r.steps, 80).map((x) => (x.k === "H" ? x : { k: stepsK, t: x.t }));
  return {
    title: str(r.title, 160).trim(), chapterId: str(r.chapterId, 20), porsjoner: str(r.porsjoner, 20), tid: str(r.tid, 40),
    ingredients: cleanList(r.ingredients, 80), steps, tips: (Array.isArray(r.tips) ? r.tips : []).slice(0, 20).map((t) => str(t, 600)).filter(Boolean),
    img: await keepImage(r.img),
    ...(r.forrett ? { forrett: true } : {}),
  };
}

export default async (req, context) => {
  if (req.method === "GET") {
    const all = await readAll();
    const weekly = await store("recipes").get("weekly", { type: "json" }).catch(() => null);
    return json(200, { docs: all.docs || {}, weekly: weekly || null });
  }
  if (req.method !== "POST") return json(405, { message: "Ikke tillatt" });
  const origin = req.headers.get("origin") || "", host = req.headers.get("host") || "";
  if (origin && !origin.endsWith("//" + host)) return json(403, { message: "Ikke tillatt" });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(413, { message: "Oppskriften eller bildet er for stort." });
  let b; try { b = JSON.parse(raw); } catch (e) { return json(400, { message: "Ugyldig forespørsel" }); }
  const now = new Date().toISOString();

  if (b.action === "submit") {
    const ip = (context && context.ip) || req.headers.get("x-nf-client-connection-ip") || "ukjent";
    const t = Date.now(), list = (hits.get(ip) || []).filter((x) => t - x < 3600_000);
    if (list.length >= SUBMIT_PER_HOUR) return json(429, { message: "Du har sendt mange oppskrifter nå. Prøv igjen senere." });
    list.push(t); hits.set(ip, list);
    const recipe = await cleanRecipe(b.recipe);
    if (!recipe.title || !recipe.ingredients.length) return json(400, { message: "Oppskriften mangler tittel eller ingredienser." });
    const id = newId("in");
    await store("inbox").setJSON(id, { id, at: now, from: str(b.from, 80), recipe });
    return json(200, { ok: true });
  }

  if (!isOwner(b.token)) return json(401, { message: "Bare Morten kan gjøre dette." });

  if (b.action === "inbox") {
    const s = store("inbox"); const { blobs } = await s.list();
    const items = (await Promise.all(blobs.map((x) => s.get(x.key, { type: "json" })))).filter(Boolean).sort((a, c) => String(c.at).localeCompare(String(a.at)));
    return json(200, { items });
  }
  if (b.action === "approve") {
    const s = store("inbox"); const it = await s.get(str(b.id, 80), { type: "json" });
    if (!it) return json(404, { message: "Fant ikke oppskriften." });
    const all = await readAll(); const id = newId("egen");
    const doc = { ...it.recipe, ...(b.chapterId ? { chapterId: str(b.chapterId, 20) } : {}), custom: true, from: it.from || "", createdAt: now, updatedAt: now };
    all.docs[id] = doc; await writeAll(all); await s.delete(it.id);
    return json(200, { ok: true, id, doc });
  }
  if (b.action === "reject") { await store("inbox").delete(str(b.id, 80)); return json(200, { ok: true }); }
  if (b.action === "set") {
    const id = str(b.id, 80); if (!id) return json(400, { message: "Mangler id" });
    const all = await readAll(); const d = b.doc || {};
    const doc = d.deleted ? { deleted: true, updatedAt: now } : { ...(await cleanRecipe(d, { stepsK: "S" })), custom: !!d.custom, createdAt: str(d.createdAt, 40) || now, updatedAt: now };
    all.docs[id] = doc; await writeAll(all);
    return json(200, { ok: true, id, doc });
  }
  if (b.action === "weekly") {
    if (b.clear) { await store("recipes").delete("weekly"); return json(200, { ok: true, weekly: null }); }
    const weekly = { rid: str(b.rid, 80), msg: str(b.msg, 300).trim(), at: now };
    if (!weekly.rid) return json(400, { message: "Mangler oppskrift" });
    await store("recipes").setJSON("weekly", weekly); return json(200, { ok: true, weekly });
  }
  if (b.action === "delete") { const all = await readAll(); delete all.docs[str(b.id, 80)]; await writeAll(all); return json(200, { ok: true }); }
  return json(400, { message: "Ukjent handling" });
};

export const config = { path: "/api/recipes" };
