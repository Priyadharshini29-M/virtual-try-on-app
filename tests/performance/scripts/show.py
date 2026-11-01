#!/usr/bin/env python3
"""Print a compact, evidence-only digest of one saved run:  python scripts/show.py [profile|run-dir-name]  (default: latest)."""
import csv, glob, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.abspath(os.path.join(HERE, "..", "..", "..", "reports", "results"))
arg = sys.argv[1] if len(sys.argv) > 1 else ""
cands = sorted(glob.glob(os.path.join(RES, f"*{arg}*" if arg else "*")))
cands = [c for c in cands if os.path.isfile(os.path.join(c, "summary.json"))]
if not cands:
    sys.exit("no runs found")
d = cands[-1]
meta = json.load(open(os.path.join(d, "meta.json")))
m = json.load(open(os.path.join(d, "summary.json")))["metrics"]
v = lambda k, f: m.get(k, {}).get("values", {}).get(f)
cnt = lambda k: int(v(k, "count") or 0)

print("run:", os.path.basename(d), "| duration_s:", meta["duration_s"], "| k6 exit:", meta["k6_exit_code"])
print("integration:", meta["integration"])
a = meta["args"]
print(f"mock: workers={a['mock_workers']} gen={a['mock_gen_ms']}ms | apache workers={a['app_workers']} | max_vus={a['max_vus']}")
print(f"http_reqs={cnt('http_reqs')} rps={v('http_reqs','rate'):.1f} failed={v('http_req_failed','rate')*100:.2f}% vus_max={int(v('vus_max','max') or 0)}")
print(f"http_req_duration ms: avg={v('http_req_duration','avg'):.0f} p50={v('http_req_duration','med'):.0f} p90={v('http_req_duration','p(90)'):.0f} p95={v('http_req_duration','p(95)'):.0f} p99={v('http_req_duration','p(99)'):.0f} max={v('http_req_duration','max'):.0f}")
for k in ("tryon_submit_ms", "tryon_status_ms", "tryon_e2e_ms", "result_fetch_ms"):
    if k in m:
        print(f"  {k}: p50={v(k,'med'):.0f} p90={v(k,'p(90)'):.0f} p95={v(k,'p(95)'):.0f} max={v(k,'max'):.0f}")
for k in ("tryon_completed", "tryon_failed", "tryon_timeout", "tryon_submit_rejected", "status_polls", "extra_polls_after_complete",
          "quota_accepted", "quota_rejected_429", "upload_valid_ok", "upload_invalid_rejected", "upload_unexpected"):
    if k in m:
        print(f"  {k}={cnt(k)}")
if "tryon_success" in m:
    print(f"  tryon_success rate={v('tryon_success','rate')*100:.1f}%")
print("thresholds:", {k: ("PASS" if all(t.get('ok', True) if isinstance(t, dict) else t for t in x.get("thresholds", {}).values()) else "FAIL") for k, x in m.items() if x.get("thresholds")})
print("checks:", m.get("checks", {}).get("values"))
print("mock queue:", {k: meta["mock_stats"].get(k) for k in ("submitted", "completed", "maxQueueDepth", "queueWaitMs")} if meta.get("mock_stats") else None)
print("consistency:", meta.get("consistency"), "| quota merchant2:", meta["pre"]["count_m2"], "->", meta["post"]["count_m2"], "| result_files:", meta["post"]["result_files"])
print("db: max_used_connections=", meta["post"]["db_max_used_connections"], "slow_queries=", meta["post"]["db_slow_queries"])
rows = list(csv.DictReader(open(os.path.join(d, "monitor.csv"))))
mx = lambda key: max([float(r[key]) for r in rows if r.get(key) not in (None, "")] or [0])
print(f"resources (max over {len(rows)} samples): app cpu={mx('app_cpu_pct'):.0f}% mem={mx('app_mem_mib'):.0f}MiB | db cpu={mx('db_cpu_pct'):.0f}% mem={mx('db_mem_mib'):.0f}MiB | "
      f"apache busy={mx('apache_busy'):.0f} | db threads_connected={mx('db_threads_connected'):.0f} | mock queue depth={mx('mock_queue_depth'):.0f}")
