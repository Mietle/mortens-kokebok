// Viser bilder fra innsendte og publiserte oppskrifter: /api/img/<nøkkel>
import { getStore } from "@netlify/blobs";

export default async (req, context) => {
  const key = (context && context.params && context.params.key) || "";
  if (!/^i[0-9a-z]+$/.test(key)) return new Response("Ikke funnet", { status: 404 });
  const res = await getStore({ name: "images", consistency: "strong" }).getWithMetadata(key, { type: "arrayBuffer" });
  if (!res || !res.data) return new Response("Ikke funnet", { status: 404 });
  const type = (res.metadata && res.metadata.type) || "image/jpeg";
  return new Response(res.data, { headers: { "content-type": type, "cache-control": "public, max-age=31536000, immutable" } });
};

export const config = { path: "/api/img/:key" };
