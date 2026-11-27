// Anonym bruksstatistikk for Mortens Kokebok (bare Morten kan lese den).
//  POST /api/stats {dev, first, day:{d,o,r,c,s}}      -> lagrer én oppsummering per enhet per dag
//  POST /api/stats {action:"read", token}             -> tall for de siste 30 dagene
// Ingen navn, e-post eller IP lagres – bare en tilfeldig enhets-id som lages på telefonen.
import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

const EIERHASH = "14dacdf1dfad279c87050573c72e318f1e76380331d1001b17bf2cb412833379";
const store = () => getStore({ name: "stats", consistency: "strong" });
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const isOwner = (tok) => typeof tok === "string" && tok.length > 8 && createHash("sha256").update(tok).digest("hex") === EIERHASH;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const num = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

async function readAll(s, prefix) {
  const { blobs } = await s.list({ prefix });
  const out = [];
  for (let i = 0; i < blobs.length; i += 40) {
    const part = await Promise.all(blobs.slice(i, i + 40).map(async (b) => ({ key: b.key, v: await s.get(b.key, { type: "json" }).catch(() => null) })));
    out.push(...part.filter((x) => x.v));
  }
  return out;
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { message: "Ikke tillatt" });
  const origin = req.headers.get("origin") || "", host = req.headers.get("host") || "";
  if (origin && !origin.endsWith("//" + host)) return json(403, { message: "Ikke tillatt" });
  const raw = await req.text();
  if (raw.length > 20000) return json(413, { message: "For stor" });
  let b; try { b = JSON.parse(raw); } catch (e) { return json(400, { message: "Ugyldig" }); }
  const s = store();

  if (b.action !== "read") {
    const dev = String(b.dev || ""), d = b.day || {};
    if (!/^[a-z0-9]{8,32}$/.test(dev) || !DAY.test(String(d.d || ""))) return json(400, { message: "Ugyldig" });
    if (d.d < daysAgo(3) || d.d > daysAgo(-1)) return json(200, { ok: true }); // gamle eller rare datoer ignoreres
    const r = {}; Object.entries(d.r || {}).slice(0, 150).forEach(([k, v]) => { if (/^[a-z0-9]{2,40}$/i.test(k)) r[k] = num(v, 500); });
    await s.setJSON(`d/${d.d}/${dev}`, { first: DAY.test(String(b.first || "")) ? b.first : d.d, o: num(d.o, 500), c: num(d.c, 500), s: d.s ? 1 : 0, r });
    return json(200, { ok: true });
  }

  if (!isOwner(b.token)) return json(401, { message: "Bare Morten kan se statistikken." });
  const from = daysAgo(29), d7 = daysAgo(6);
  const rows = (await readAll(s, "d/")).map(({ key, v }) => { const [, day, dev] = key.split("/"); return { day, dev, ...v }; });
  // rydd: slett data eldre enn 120 dager
  const old = rows.filter((x) => x.day < daysAgo(120)); await Promise.all(old.slice(0, 200).map((x) => s.delete(`d/${x.day}/${x.dev}`).catch(() => {})));
  const recent = rows.filter((x) => x.day >= from);
  const days = []; for (let i = 29; i >= 0; i--) days.push({ d: daysAgo(i), users: 0, opens: 0, chef: 0 });
  const byDay = Object.fromEntries(days.map((x) => [x.d, x]));
  const u30 = new Set(), u7 = new Set(), news = new Set(), home = new Set(), recipes = {}, firstSeen = {};
  for (const x of rows) { if (!firstSeen[x.dev] || x.first < firstSeen[x.dev]) firstSeen[x.dev] = x.first; }
  for (const x of recent) {
    const t = byDay[x.day]; if (t) { t.users++; t.opens += x.o || 0; t.chef += x.c || 0; }
    u30.add(x.dev); if (x.day >= d7) u7.add(x.dev); if (x.s) home.add(x.dev);
    Object.entries(x.r || {}).forEach(([k, v]) => { recipes[k] = (recipes[k] || 0) + v; });
  }
  u30.forEach((dev) => { if ((firstSeen[dev] || "") >= from) news.add(dev); });
  const allDevs = new Set(rows.map((x) => x.dev));
  const usage = (await readAll(s, "u/")).filter(({ key }) => key.split("/")[1] >= from).map(({ v }) => v);
  const tokIn = usage.reduce((a, x) => a + (x.in || 0), 0), tokOut = usage.reduce((a, x) => a + (x.out || 0), 0);
  const pin = Number(process.env.CHEF_PRICE_IN || 0), pout = Number(process.env.CHEF_PRICE_OUT || 0);
  return json(200, {
    days, users7: u7.size, users30: u30.size, usersAll: allDevs.size, new30: news.size, home30: home.size,
    opens30: days.reduce((a, x) => a + x.opens, 0),
    top: Object.entries(recipes).sort((a, c) => c[1] - a[1]).slice(0, 10).map(([id, n]) => ({ id, n })),
    chef: { questions: days.reduce((a, x) => a + x.chef, 0), calls: usage.length, tokIn, tokOut, usd: pin || pout ? Math.round(((tokIn * pin + tokOut * pout) / 1e6) * 100) / 100 : null },
  });
};

export const config = { path: "/api/stats" };
