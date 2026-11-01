#!/usr/bin/env python3
"""Builds the results table (Markdown) and SVG charts from saved runs. Standard library only.
Every number comes from reports/results/<run>/summary.json|meta.json|monitor.csv - nothing is typed in by hand.
Usage: python scripts/make_report.py   -> writes reports/charts/*.svg and reports/results/results_table.md
"""
import csv, glob, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
RES = os.path.join(REPO, "reports", "results")
CHARTS = os.path.join(REPO, "reports", "charts")
os.makedirs(CHARTS, exist_ok=True)

# (label, run-dir suffix, integration label, mock gpu workers shown in the table)
RUNS = [
    ("Smoke", "20261021-174932-smoke"),
    ("Baseline", "20261021-182858-baseline"),
    ("Load", "20261021-183224-load"),
    ("Stress (widget+try-on)", "20261021-184848-stress"),
    ("Stress-heavy (+admin+upload)", "20261021-191335-stress_heavy"),
    ("Spike", "20261021-183756-spike"),
    ("Spike, 1 GPU worker", "20261021-184233-spike"),
    ("Soak (10 min)", "20261021-190117-soak"),
    ("Recovery (after container restart)", "20261021-185544-recovery"),
]
extra = sorted(glob.glob(os.path.join(RES, "*-recovery")))
if extra and os.path.basename(extra[-1]) != "20261021-185544-recovery":
    RUNS.append(("Recovery (NO restart, after spike)", os.path.basename(extra[-1])))


def load(run):
    d = os.path.join(RES, run)
    meta = json.load(open(os.path.join(d, "meta.json")))
    m = json.load(open(os.path.join(d, "summary.json")))["metrics"]
    rows = list(csv.DictReader(open(os.path.join(d, "monitor.csv"))))
    return d, meta, m, rows


def val(m, k, f):
    return m.get(k, {}).get("values", {}).get(f)


def mx(rows, key):
    v = [float(r[key]) for r in rows if r.get(key) not in (None, "")]
    return max(v) if v else 0.0


def verdict(m):
    bad = [k for k, x in m.items() for t in (x.get("thresholds") or {}).values() if not t]
    return "FAIL" if bad else "PASS", bad


table = ["| Scenario | Integration | Max VUs | Duration | Requests | Throughput | p95 latency | Failure rate | App CPU max | App mem max | DB CPU max | Result |",
         "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|"]
bars, pairs = [], []
for label, run in RUNS:
    if not os.path.isdir(os.path.join(RES, run)):
        continue
    d, meta, m, rows = load(run)
    res, bad = verdict(m)
    gpu = meta["args"]["mock_workers"]
    p95 = val(m, "http_req_duration", "p(95)")
    table.append(f"| {label} | MOCKED AI ({gpu} sim. GPU worker{'s' if gpu != 1 else ''}) | {int(val(m,'vus_max','max') or 0)} | {meta['duration_s']:.0f} s | "
                 f"{int(val(m,'http_reqs','count'))} | {val(m,'http_reqs','rate'):.1f} req/s | {p95:.0f} ms | {val(m,'http_req_failed','rate')*100:.2f}% | "
                 f"{mx(rows,'app_cpu_pct'):.0f}% | {mx(rows,'app_mem_mib'):.0f} MiB | {mx(rows,'db_cpu_pct'):.0f}% | **{res}** |")
    bars.append((label, p95, res))
    pairs.append((label, val(m, "http_reqs", "rate"), p95))
open(os.path.join(RES, "results_table.md"), "w", encoding="utf8").write("\n".join(table) + "\n")


def svg_bars(path, title, items, unit, thresh=None):
    w, h, left, top = 880, 60 + 34 * len(items), 250, 46
    mxv = max([v for _, v, _ in items] + ([thresh] if thresh else [1])) * 1.1
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" font-family="Segoe UI,Arial,sans-serif" font-size="13">',
           f'<rect width="{w}" height="{h}" fill="#fff"/><text x="12" y="24" font-size="16" font-weight="600">{title}</text>']
    for i, (lab, v, res) in enumerate(items):
        y = top + i * 34
        bw = (w - left - 90) * v / mxv
        col = "#2e7d32" if res == "PASS" else "#c62828"
        out.append(f'<text x="{left-8}" y="{y+16}" text-anchor="end">{lab}</text><rect x="{left}" y="{y}" width="{bw:.1f}" height="22" fill="{col}"/>'
                   f'<text x="{left+bw+6:.1f}" y="{y+16}">{v:,.0f} {unit}</text>')
    if thresh:
        x = left + (w - left - 90) * thresh / mxv
        out.append(f'<line x1="{x:.1f}" y1="{top-6}" x2="{x:.1f}" y2="{h-8}" stroke="#555" stroke-dasharray="4 3"/>'
                   f'<text x="{x+4:.1f}" y="{top-10}" fill="#555">proposed target {thresh} {unit}</text>')
    out.append("</svg>")
    open(path, "w", encoding="utf8").write("\n".join(out))


svg_bars(os.path.join(CHARTS, "p95_by_scenario.svg"), "Overall HTTP p95 latency by scenario (green = all thresholds met, red = at least one crossed)", bars, "ms", 800)
svg_bars(os.path.join(CHARTS, "throughput_by_scenario.svg"), "Throughput by scenario", [(l, t, "PASS") for l, t, _ in pairs], "req/s")


def svg_lines(path, title, series, unit, ymax=None):
    w, h, l, r, t, b = 880, 300, 56, 20, 42, 36
    xs = max((x for s in series for x, _ in s[2]), default=1) or 1
    ys = ymax or (max((y for s in series for _, y in s[2]), default=1) * 1.1 or 1)
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" font-family="Segoe UI,Arial,sans-serif" font-size="12">',
           f'<rect width="{w}" height="{h}" fill="#fff"/><text x="12" y="22" font-size="15" font-weight="600">{title}</text>',
           f'<line x1="{l}" y1="{h-b}" x2="{w-r}" y2="{h-b}" stroke="#999"/><line x1="{l}" y1="{t}" x2="{l}" y2="{h-b}" stroke="#999"/>']
    for k in range(5):
        yy = h - b - (h - b - t) * k / 4
        out.append(f'<text x="{l-6}" y="{yy+4:.0f}" text-anchor="end">{ys*k/4:.0f}</text><line x1="{l}" y1="{yy:.0f}" x2="{w-r}" y2="{yy:.0f}" stroke="#eee"/>')
    out.append(f'<text x="{w-r}" y="{h-8}" text-anchor="end">seconds into run ({unit})</text>')
    for lab, col, pts in series:
        path_d = " ".join(("M" if i == 0 else "L") + f"{l+(w-l-r)*x/xs:.1f},{h-b-(h-b-t)*y/ys:.1f}" for i, (x, y) in enumerate(pts))
        out.append(f'<path d="{path_d}" fill="none" stroke="{col}" stroke-width="2"/>')
    for i, (lab, col, _) in enumerate(series):
        out.append(f'<rect x="{l+10+i*190}" y="{t-2}" width="12" height="12" fill="{col}"/><text x="{l+26+i*190}" y="{t+9}">{lab}</text>')
    out.append("</svg>")
    open(path, "w", encoding="utf8").write("\n".join(out))


for tag, run in (("stress_heavy", "20261021-191335-stress_heavy"), ("load", "20261021-183224-load"), ("spike_1gpu", "20261021-184233-spike")):
    if not os.path.isdir(os.path.join(RES, run)):
        continue
    _, _, _, rows = load(run)
    t0 = float(rows[0]["t"])
    get = lambda k: [(float(r["t"]) - t0, float(r[k])) for r in rows if r.get(k) not in (None, "")]
    series = [("app CPU %", "#1565c0", get("app_cpu_pct")), ("db CPU %", "#ef6c00", get("db_cpu_pct")), ("apache busy workers x10", "#6a1b9a", [(x, y * 10) for x, y in get("apache_busy")])]
    if tag == "spike_1gpu":
        series = [("mock GPU queue depth x5", "#c62828", [(x, y * 5) for x, y in get("mock_queue_depth")])] + series[:2]
    svg_lines(os.path.join(CHARTS, f"resources_{tag}.svg"), f"Container resources during '{tag}' (sampled every ~5 s)", series, "mixed units, see legend")

print("\n".join(table))
print("charts:", sorted(os.listdir(CHARTS)))
