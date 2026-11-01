#!/usr/bin/env python3
"""Functional / auth probe of every route group in fitfyce-php/router.php. Standard library only.

SAFE BY DESIGN - refuses any target except localhost, uses only the SYNTHETIC key seeded in the
local perf DB. Authenticated calls are READ-ONLY. AI-cost and billing-like endpoints (generate,
infographic, pose-variant, plan/update, accessory-worker, ...) are probed WITHOUT credentials only
(expect 401) and are listed as NOT RUN for authenticated behaviour.

Usage: python tests/functional/module_probe.py [--base http://localhost:8080] [--out reports/results/functional.json]
"""
import argparse, json, sys, time, urllib.error, urllib.parse, urllib.request

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://localhost:8080")
ap.add_argument("--shop", default="perf-test.myshopify.com")
ap.add_argument("--key", default="tf_perf_test_key_0001")  # synthetic, local DB only
ap.add_argument("--out", default="reports/results/functional-probe.json")
a = ap.parse_args()
host = urllib.parse.urlparse(a.base).hostname
if host not in ("localhost", "127.0.0.1"):
    sys.exit("refusing: this probe only targets a local replica")


def call(method, path, key=None, body=None, shop=True):
    url = a.base + path
    if shop and "shop=" not in path:
        url += ("&" if "?" in path else "?") + "shop=" + a.shop
    h = {"Accept": "application/json"}
    if key is not None:
        h["X-Api-Key"] = key
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    t = time.time()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            code, txt = r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        code, txt = e.code, e.read().decode("utf-8", "replace")
    except Exception as e:  # connection error
        return {"status": 0, "ms": 0, "json": False, "snippet": str(e)[:120]}
    ms = round((time.time() - t) * 1000)
    try:
        json.loads(txt)
        isjson = True
    except Exception:
        isjson = False
    return {"status": code, "ms": ms, "json": isjson, "snippet": txt[:110].replace("\n", " ")}


# (module, method, path, kind)   kind: public | admin_read | admin_write_unauth_only
R = [
    ("Widget", "GET", "/api/widget-settings", "public"),
    ("Widget", "POST", "/api/widget-event", "public_post"),
    ("Widget settings (admin)", "GET", "/widget/settings", "admin_read"),
    ("Widget settings (admin)", "PATCH", "/widget/settings", "admin_write"),
    ("Settings", "GET", "/settings", "admin_read"),
    ("Settings", "POST", "/settings", "admin_write"),
    ("Product Catalog", "GET", "/products", "admin_read"),
    ("Product Catalog", "POST", "/products/sync", "admin_write"),
    ("Product Catalog", "GET", "/variants/mapping", "admin_read"),
    ("Product Catalog", "GET", "/shop/products", "admin_read"),
    ("Product Catalog", "POST", "/shopify/sync", "admin_write"),
    ("Shop", "GET", "/shop", "admin_read"),
    ("Analytics", "GET", "/analytics", "admin_read"),
    ("Analytics", "POST", "/conversion", "admin_write"),
    ("Plans & usage", "GET", "/plans", "admin_read"),
    ("Plans & usage", "GET", "/plan/limit", "admin_read"),
    ("Plans & usage", "POST", "/plan/update", "admin_write"),
    ("Leads", "GET", "/leads", "shop_auth_read"),
    ("Leads", "GET", "/lead/list", "master_only"),
    ("Leads", "POST", "/api/lead/capture", "public_post"),
    ("Sessions", "POST", "/api/session/create", "public_post"),
    ("Merchant", "GET", "/merchant/by-domain", "admin_read"),
    ("Merchant", "GET", "/merchant/onboarding", "admin_read"),
    ("Merchant", "POST", "/merchant/deactivate", "admin_write"),
    ("Size Chart", "GET", "/size-chart", "admin_read"),
    ("Size Chart", "GET", "/api/size-chart", "public"),
    ("Complete Look", "GET", "/complete-look", "admin_read"),
    ("Complete Look", "GET", "/api/complete-look", "public"),
    ("AI Studio v1 / Garment Studio", "GET", "/studio/setup-check", "shop_auth_read"),
    ("AI Studio v1 / Garment Studio", "GET", "/studio/models", "shop_auth_read"),
    ("AI Studio v1 / Garment Studio", "GET", "/studio/sessions", "shop_auth_read"),
    ("AI Studio v1 / Garment Studio", "GET", "/studio/default-models", "admin_read"),
    ("AI Studio v1 / Garment Studio", "POST", "/studio/generate", "shop_auth_write"),
    ("AI Studio v1 / Garment Studio", "POST", "/studio/pose-variant", "shop_auth_write"),
    ("AI Studio v2 / Asset Library", "GET", "/studio-v2/models", "shop_auth_read"),
    ("AI Studio v2 / Asset Library", "GET", "/studio-v2/generations", "shop_auth_read"),
    ("AI Studio v2 / Asset Library", "GET", "/studio-v2/assets", "shop_auth_read"),
    ("AI Studio v2 / Asset Library", "POST", "/studio-v2/generate", "shop_auth_write"),
    ("AI Studio v2 / Asset Library", "POST", "/studio-v2/regenerate-infographics", "shop_auth_write"),
    ("Infographic", "POST", "/infographic/generate", "shop_auth_write"),
    ("Infographic", "POST", "/infographic/extract-points", "shop_auth_write"),
    ("RAG index", "GET", "/rag/status", "admin_read"),
    ("RAG index", "POST", "/rag/reindex", "admin_write"),
    ("Accessory worker", "POST", "/accessory-worker", "hmac_only"),
    ("Try-on", "GET", "/api/tryon-status", "public_status"),
    ("Upload", "POST", "/upload-temp", "public_post"),
]

rows = []
for mod, m, p, kind in R:
    row = {"module": mod, "method": m, "path": p, "kind": kind}
    body = {} if m in ("POST", "PATCH") else None
    if kind.startswith("admin") or kind in ("shop_auth_read","shop_auth_write","master_only","hmac_only"):
        row["no_key"] = call(m, p, None, body)
        row["bad_key"] = call(m, p, "tf_wrong_key", body)
        if kind in ("admin_read",):
            row["good_key"] = call(m, p, a.key, body)
    else:
        row["anon"] = call(m, p, None, body)
    rows.append(row)


def verdict(r):
    notes = []
    if r["kind"] in ("shop_auth_read", "shop_auth_write"):
        # authenticated by ?shop= alone. Without it the route must refuse; WITH only a shop domain it
        # must not hand out data. Report as a finding when a shop-only call is accepted.
        r["no_shop"] = call(r["method"], r["path"], None, {} if r["method"] == "POST" else None, shop=False)
        if r["no_shop"]["status"] != 401:
            notes.append(f"no shop/no key -> {r['no_shop']['status']} (expected 401)")
        if r["kind"] == "shop_auth_read" and r["no_key"]["status"] == 200:
            notes.append("FINDING: accepts shop domain alone (no secret) -> data readable by anyone who knows the domain")
        if r["kind"] == "shop_auth_write" and r["no_key"]["status"] not in (401, 403):
            notes.append(f"FINDING: shop-only auth reaches handler (status {r['no_key']['status']}); AI-cost endpoint")
        return notes
    if r["kind"] in ("master_only", "hmac_only"):
        for k in ("no_key", "bad_key"):
            if r[k]["status"] not in (401, 403):
                notes.append(f"{k}->{r[k]['status']} (expected 401/403)")
        return notes
    if r["kind"].startswith("admin"):
        for k in ("no_key", "bad_key"):
            if r[k]["status"] != 401:
                notes.append(f"{k}->{r[k]['status']} (expected 401)")
        if r["kind"] == "admin_read":
            g = r["good_key"]
            if g["status"] >= 500 or g["status"] == 0:
                notes.append(f"good_key->{g['status']} server error")
            elif g["status"] == 404:
                notes.append("good_key->404 (route/module missing or no data)")
            elif g["status"] == 401:
                notes.append("good_key->401 (synthetic key rejected)")
            elif not g["json"]:
                notes.append("good_key response not JSON")
    else:
        s = r["anon"]["status"]
        if s >= 500 or s == 0:
            notes.append(f"anon->{s} server error on bad/empty input")
    return notes


fails = 0
for r in rows:
    r["issues"] = verdict(r)
    r["result"] = "PASS" if not r["issues"] else "FAIL"
    fails += bool(r["issues"])
    st = r.get("good_key") or r.get("anon") or r["no_key"]
    print(f"{r['result']:4} {r['method']:6} {r['path']:36} no_key={r.get('no_key',{}).get('status','-')!s:4} "
          f"bad_key={r.get('bad_key',{}).get('status','-')!s:4} main={st['status']} {st['ms']}ms  {'; '.join(r['issues'])}")
json.dump({"base": a.base, "shop": a.shop, "when": time.strftime("%Y-%m-%d %H:%M:%S"), "rows": rows},
          open(a.out, "w"), indent=1)
print(f"\n{len(rows)} routes probed, {fails} with issues -> {a.out}")
