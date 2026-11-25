import { getStore } from "@netlify/blobs";
// «Spør Morten» – trygg kobling til Claude. API-nøkkelen ligger i Netlify (ANTHROPIC_API_KEY) og vises aldri i appen.
// Begrensninger: maks antall spørsmål per bruker (IP) per time, størrelse på forespørsel og svarlengde.
// Det viktigste taket settes som månedsgrense (spend limit) i Anthropic Console.

const LIMIT_PER_HOUR = Number(process.env.CHEF_LIMIT_PER_HOUR || 40);
const MODEL = process.env.CHEF_MODEL || "claude-sonnet-5-5";
const MODEL_QUICK = process.env.CHEF_MODEL_QUICK || "claude-haiku-5-5";
const MAX_BODY = 5_500_000;
const hits = new Map();

const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export default async (req, context) => {
  if (req.method !== "POST") return json(405, { message: "Bare POST" });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json(503, { message: "«Spør Morten» er ikke satt opp ennå (mangler API-nøkkel)." });

  // Bare forespørsler fra selve appen
  const origin = req.headers.get("origin") || "";
  const host = req.headers.get("host") || "";
  if (origin && !origin.endsWith("//" + host)) return json(403, { message: "Ikke tillatt" });

  const ip = (context && context.ip) || req.headers.get("x-nf-client-connection-ip") || "ukjent";
  const now = Date.now(), hour = 3600_000;
  const list = (hits.get(ip) || []).filter((t) => now - t < hour);
  if (list.length >= LIMIT_PER_HOUR) return json(429, { message: "Morten har svart på mange spørsmål den siste timen. Prøv igjen litt senere." });
  list.push(now); hits.set(ip, list);

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(413, { message: "Bildet eller teksten er for stor." });
  let body; try { body = JSON.parse(raw); } catch (e) { return json(400, { message: "Ugyldig forespørsel" }); }
  const messages = Array.isArray(body.messages) ? body.messages.slice(-40) : null;
  if (!messages || !messages.length) return json(400, { message: "Mangler spørsmål" });
  const tools = Array.isArray(body.tools) ? body.tools.slice(0, 12) : [];

  const payload = {
    model: body.tier === "quick" ? MODEL_QUICK : MODEL,
    max_tokens: 2500,
    messages,
    ...(typeof body.system === "string" && body.system ? { system: body.system.slice(0, 4000) } : {}),
    ...(tools.length ? { tools } : {}),
  };
  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(payload),
    });
  } catch (e) { return json(502, { message: "Fikk ikke kontakt med Claude. Prøv igjen." }); }
  const out = await r.json().catch(() => null);
  if (!r.ok || !out) {
    const msg = (out && out.error && out.error.message) || "";
    console.error("Anthropic-feil", r.status, msg);
    if (r.status === 429 || r.status === 529) return json(429, { message: "Morten er opptatt akkurat nå. Prøv igjen om litt." });
    if (/credit|billing|balance/i.test(msg)) return json(402, { message: "«Spør Morten» er tom for kreditt. Si fra til Morten." });
    return json(502, { message: "Noe gikk galt hos Claude. Prøv igjen." });
  }
  try { // forbruk til statistikken (bare antall tokens, ikke innholdet)
    const u = out.usage || {}; const day = new Date().toISOString().slice(0, 10);
    await getStore({ name: "stats" }).setJSON(`u/${day}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, { in: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), out: u.output_tokens || 0, model: payload.model });
  } catch (e) {}
  return json(200, { content: out.content || [], stop_reason: out.stop_reason });
};

export const config = { path: "/api/chef" };
