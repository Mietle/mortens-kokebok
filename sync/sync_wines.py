"""Synker Mortens vinkjeller (artifact-databasen) inn i Mortens Kokebok.

  plan  <celdir> <repo>
      Skriver JSON {"copy": [cellar-asset-id, ...]}: flaskebilder som må kopieres inn i kokeboka.
  build <celdir> <repo> <newmap.json> <dldir> <out_wines.json>
      newmap.json = {"<cellar-asset-id>": "<kokebok-asset-id>"}, dldir har <kokebok-asset-id>.webp.
      Oppdaterer repo/sync/wines.json + blobmap.txt, repo/public/wines.json + public/blob og sw.js,
      og skriver kokebokas wines.json (med /_blob/-stier) til out_wines.json.
      Siste linje: JSON {"changed": bool, "added": [...], "removed": [...], "changes": n, "total": n}
<celdir> er mappa med <id>.json for hver vin (ArtifactData list wines med out_dir).
"""
import json, os, re, sys, glob, shutil, datetime

def load_docs(celdir):
    docs = {}
    for f in glob.glob(os.path.join(celdir, "**", "*.json"), recursive=True):
        try:
            d = json.load(open(f))
        except Exception:
            continue
        if isinstance(d, dict) and d.get("name") and (d.get("id") or d.get("code")):
            docs[str(d.get("id") or d.get("code"))] = d
    return docs

def load_map(repo):
    m = {}
    p = os.path.join(repo, "sync", "blobmap.txt")
    if os.path.exists(p):
        for l in open(p):
            p2 = l.split()
            if len(p2) == 2:
                m[p2[1]] = p2[0]  # cellar -> kokebok
    return m

def conv(d, m):
    v = d.get("vmp") or {}
    k = d.get("kongsberg") or {}
    a = d.get("bottleAsset")
    vol = v.get("volume") or (f"{d['volume']} cl" if d.get("volume") else None)
    return {"id": str(d.get("id") or d.get("code")), "name": d.get("name"), "vintage": d.get("vintage"), "type": d.get("type"),
            "country": d.get("country"), "district": d.get("district"), "sub": d.get("subDistrict"), "grapes": v.get("grapes"),
            "style": v.get("style"), "pairing": d.get("pairing") or [], "qty": d.get("qty") or 0, "rating": d.get("rating"),
            "comment": d.get("comment") or "", "price": d.get("price"), "url": d.get("url"),
            "img": ("/_blob/" + m[a]) if a in m else None, "producer": d.get("producer"), "color": d.get("color"),
            "smell": d.get("smell"), "taste": d.get("taste"), "scales": d.get("scales"), "alcohol": v.get("alcohol"),
            "sugar": v.get("sugar"), "acid": v.get("acid"), "method": v.get("method"), "storage": v.get("storage"),
            "cork": v.get("cork"), "volume": vol, "stockKongsberg": k.get("n"), "stockAt": k.get("at"), "vmpPrice": d.get("vmpPrice")}

def plan(celdir, repo):
    docs, m = load_docs(celdir), load_map(repo)
    need = sorted({d["bottleAsset"] for d in docs.values() if d.get("bottleAsset") and d["bottleAsset"] not in m})
    print(json.dumps({"copy": need, "wines": len(docs)}))

def build(celdir, repo, newmap, dldir, out):
    docs, m = load_docs(celdir), load_map(repo)
    if not docs:
        raise SystemExit("Fant ingen viner i " + celdir)
    nm = json.load(open(newmap)) if newmap and os.path.exists(newmap) else {}
    os.makedirs(os.path.join(repo, "public", "blob"), exist_ok=True)
    with open(os.path.join(repo, "sync", "blobmap.txt"), "a") as f:
        for cel, kok in nm.items():
            src = os.path.join(dldir, kok + ".webp")
            if not os.path.exists(src):
                continue
            shutil.copy(src, os.path.join(repo, "public", "blob", kok + ".webp"))
            if cel not in m:
                f.write(f"{kok} {cel}\n"); m[cel] = kok
    sp = os.path.join(repo, "sync", "wines.json")
    old = json.load(open(sp)) if os.path.exists(sp) else {"wines": []}
    oldm = {str(w["id"]): w for w in old["wines"]}
    order = [str(w["id"]) for w in old["wines"] if str(w["id"]) in docs] + [i for i in docs if i not in oldm]
    wines = [conv(docs[i], m) for i in order]
    added = [w["name"] for w in wines if w["id"] not in oldm]
    removed = [w["name"] for i, w in oldm.items() if i not in docs]
    changes = sum(1 for w in wines if w["id"] in oldm and w != oldm[w["id"]])
    changed = bool(added or removed or changes)
    res = {"at": datetime.date.today().isoformat(), "wines": wines}
    json.dump(res, open(out, "w"), ensure_ascii=False)
    if changed:
        json.dump(res, open(sp, "w"), ensure_ascii=False)
        blob = set(os.listdir(os.path.join(repo, "public", "blob")))
        def fix(mo):
            i = mo.group(1)
            hit = [b for b in blob if b.startswith(i + ".")]
            return "/blob/" + (hit[0] if hit else i + ".webp")
        pub = re.sub(r"/_blob/([0-9a-f]{32})", fix, json.dumps(res, ensure_ascii=False))
        open(os.path.join(repo, "public", "wines.json"), "w").write(pub)
        swp = os.path.join(repo, "public", "sw.js")
        sw = open(swp).read()
        open(swp, "w").write(re.sub(r'const V = "mk-\d+"', 'const V = "mk-' + datetime.datetime.now().strftime("%Y%m%d%H%M%S") + '"', sw))
    print(json.dumps({"changed": changed, "added": added, "removed": removed, "changes": changes, "total": len(wines),
                      "noimg": [w["name"] for w in wines if not w["img"]]}, ensure_ascii=False))

if __name__ == "__main__":
    a = sys.argv[1:]
    if a and a[0] == "plan" and len(a) == 3:
        plan(a[1], a[2])
    elif a and a[0] == "build" and len(a) == 6:
        build(*a[1:])
    else:
        print(__doc__); sys.exit(2)
