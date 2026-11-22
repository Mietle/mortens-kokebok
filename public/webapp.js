// Mortens Kokebok – webapp-kobling. Gir appen «Spør Morten» via /api/chef (Netlify-funksjon med API-nøkkelen).
(function () {
  window.MK_WEBAPP = true;
  document.documentElement.classList.add("webapp"); // gir plass til «Powered by Netlify»-merket nede til høyre
  const API = "/api/chef";
  const err = (code, message, text) => Object.assign(new Error(message || code), { code, text });

  const blobToB64 = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(b); });

  async function toMessages(input, images) {
    let msgs = typeof input === "string" ? [{ role: "user", content: input }] : input.map((m) => ({ role: m.role, content: m.content }));
    if (images && images.length) {
      const last = msgs[msgs.length - 1];
      const blocks = [];
      for (const im of images) blocks.push({ type: "image", source: { type: "base64", media_type: im.type || "image/jpeg", data: await blobToB64(im) } });
      blocks.push({ type: "text", text: String(last.content) });
      last.content = blocks;
    }
    return msgs;
  }

  async function call(body, signal) {
    let r;
    try { r = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal }); }
    catch (e) { if (e && e.name === "AbortError") throw e; throw err("network", "Ingen nettforbindelse", "Fikk ikke kontakt. Sjekk nettet og prøv igjen."); }
    let j = null; try { j = await r.json(); } catch (e) {}
    if (r.status === 429) throw err("rate_limited", "rate", (j && j.message) || "Morten trenger en liten pause. Prøv igjen litt senere.");
    if (!r.ok || !j) throw err("failed", "feil", (j && j.message) || "Noe gikk galt. Prøv å spørre på nytt.");
    return j;
  }

  async function sample(input, opts = {}) {
    const tools = opts.tools || [];
    const defs = tools.map((t) => ({ name: t.name, description: t.description || "", input_schema: t.inputSchema || { type: "object", properties: {} } }));
    let messages = await toMessages(input, opts.images);
    let text = "";
    for (let round = 0; round < 6; round++) {
      const res = await call({ messages, tools: defs, tier: opts.modelTier || "default", system: opts.system || "" }, opts.signal);
      const blocks = res.content || [];
      const said = blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
      if (said) { text = text ? text + "\n\n" + said : said; if (opts.onText) try { opts.onText({ text, delta: said }); } catch (e) {} }
      const uses = blocks.filter((b) => b.type === "tool_use");
      if (res.stop_reason !== "tool_use" || !uses.length) return { text, truncated: res.stop_reason === "max_tokens" };
      messages = messages.concat([{ role: "assistant", content: blocks }]);
      const results = [];
      for (const u of uses) {
        const t = tools.find((x) => x.name === u.name);
        let out, isErr = false;
        try { out = t ? await t.execute(u.input || {}) : "Ukjent verktøy"; } catch (e) { out = String((e && e.message) || e); isErr = true; }
        results.push({ type: "tool_result", tool_use_id: u.id, content: typeof out === "string" ? out : JSON.stringify(out ?? null), is_error: isErr });
      }
      messages.push({ role: "user", content: results });
    }
    return { text, truncated: true };
  }
  sample.json = async (input, opts = {}) => {
    const system = "Svar KUN med gyldig JSON, uten forklaring og uten ```-blokker.";
    const r = await sample(input, { ...opts, tools: [], system });
    const t = r.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    const m = t.match(/[\[{][\s\S]*[\]}]/);
    try { return JSON.parse(m ? m[0] : t); } catch (e) { throw err("bad_json", "Ugyldig svar", "Fikk et uventet svar. Prøv igjen."); }
  };
  sample.limits = async () => ({ images: true });

  // Bare «sample» finnes i webappen. Alt annet (konto, felles database …) er null, og appen lagrer på enheten.
  window.claude = { use: async (name) => (name === "sample" ? sample : null) };

  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
})();
