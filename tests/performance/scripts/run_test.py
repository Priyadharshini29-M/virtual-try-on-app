#!/usr/bin/env python3
"""
Orchestrates one load-test run against the LOCAL Docker replica (never production).

  python scripts/run_test.py smoke
  python scripts/run_test.py load --mock-workers 1 --mock-gen-ms 14000 --app-workers 20
  python scripts/run_test.py stress --max-vus 300 --yes-i-am-authorised

What it does: (re)starts the stack with the requested mock-AI settings, applies the repo's own
migrate.php (schema drift fix), resets test data, samples container CPU/memory + MariaDB + Apache
every 5 s, runs k6 in Docker, then checks data consistency (quota counter vs completed jobs, result
files vs completed jobs) and saves everything to reports/results/<timestamp>-<profile>/.
Standard library only.
"""
import argparse, csv, json, os, subprocess, sys, threading, time, urllib.request, datetime, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
PERF = os.path.abspath(os.path.join(HERE, ".."))
REPO = os.path.abspath(os.path.join(PERF, "..", ".."))
RESULTS = os.path.join(REPO, "reports", "results")
HEAVY = {"stress", "stress_heavy", "spike", "soak"}
ENV = dict(os.environ)


def sh(cmd, check=True, env=None, input_=None, timeout=None):
    env = env or ENV
    p = subprocess.run(cmd, cwd=PERF, capture_output=True, text=True, env=env, input=input_, timeout=timeout)
    if check and p.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)}\n{p.stdout}\n{p.stderr}")
    return p


def sql(q):
    return sh(["docker", "compose", "exec", "-T", "db", "mariadb", "-uroot", "-pperfroot", "tryfit_db", "-N", "-B", "-e", q]).stdout.strip()


def http_json(url, timeout=5):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception:
        return None


def http_text(url, timeout=5):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.read().decode()
    except Exception:
        return ""


def wait_ready(tries=60):
    for _ in range(tries):
        if http_text("http://localhost:8080/api/widget-settings?shop=perf-test.myshopify.com") and http_json("http://localhost:4010/healthz"):
            return True
        time.sleep(2)
    return False


class Monitor(threading.Thread):
    """Samples docker stats, MariaDB status, Apache workers and mock queue every `every` seconds."""
    def __init__(self, path, every=5):
        super().__init__(daemon=True)
        self.path, self.every, self.stop_evt = path, every, threading.Event()
        self.rows = []

    def sample(self):
        t = round(time.time(), 1)
        row = {"t": t}
        p = subprocess.run(["docker", "stats", "--no-stream", "--format", "{{json .}}"], capture_output=True, text=True)
        for line in p.stdout.splitlines():
            try:
                d = json.loads(line)
            except ValueError:
                continue
            n = d["Name"].replace("brixperf-", "").replace("-1", "")
            row[f"{n}_cpu_pct"] = float(d["CPUPerc"].strip("%") or 0)
            used = d["MemUsage"].split("/")[0].strip()
            mult = {"KiB": 1 / 1024, "MiB": 1, "GiB": 1024, "B": 1 / 1048576}
            for u, k in mult.items():
                if used.endswith(u):
                    row[f"{n}_mem_mib"] = round(float(used[: -len(u)]) * k, 1)
                    break
        st = http_text("http://localhost:8080/server-status?auto")
        for l in st.splitlines():
            if l.startswith("BusyWorkers:"): row["apache_busy"] = int(l.split()[1])
            if l.startswith("IdleWorkers:"): row["apache_idle"] = int(l.split()[1])
        try:
            out = sql("SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected','Threads_running','Max_used_connections','Slow_queries','Aborted_connects')")
            for l in out.splitlines():
                k, v = l.split("\t"); row[f"db_{k.lower()}"] = int(v)
        except Exception:
            pass
        m = http_json("http://localhost:4010/__stats")
        if m:
            row["mock_queue_depth"], row["mock_running"], row["mock_completed"] = m["queueDepthNow"], m["running"], m["completed"]
        self.rows.append(row)

    def run(self):
        while not self.stop_evt.is_set():
            try:
                self.sample()
            except Exception:
                pass
            self.stop_evt.wait(self.every)

    def finish(self):
        self.stop_evt.set(); self.join(timeout=20)
        keys = sorted({k for r in self.rows for k in r}, key=lambda k: (k != "t", k))
        with open(self.path, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=keys); w.writeheader(); w.writerows(self.rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("profile")
    ap.add_argument("--mock-workers", type=int, default=1, help="simulated GPU workers (real endpoint is workersMax=1)")
    ap.add_argument("--mock-gen-ms", type=int, default=14000, help="simulated generation time (measured real: ~14 s)")
    ap.add_argument("--mock-fail-rate", type=float, default=0.0)
    ap.add_argument("--mock-max-queue", type=int, default=0)
    ap.add_argument("--app-workers", type=int, default=20, help="Apache MaxRequestWorkers (assumption for a small host)")
    ap.add_argument("--max-vus", type=int, default=50)
    ap.add_argument("--dur-scale", type=float, default=1.0)
    ap.add_argument("--rate-scale", type=float, default=1.0)
    ap.add_argument("--soak-min", type=int, default=30)
    ap.add_argument("--only", default="", help="comma list of k6 scenarios to keep, e.g. widget,journey")
    ap.add_argument("--widget-event", default="1", help="0 = widget scenario only calls widget-settings")
    ap.add_argument("--keepalive", default="Off", help="Apache KeepAlive On|Off (replica artefact switch)")
    ap.add_argument("--no-restart", action="store_true", help="keep app/mock containers running (needed for a true recovery test right after a heavy run)")
    ap.add_argument("--extra-polls", type=int, default=0)
    ap.add_argument("--yes-i-am-authorised", action="store_true", help="required for stress/spike/soak")
    a = ap.parse_args()

    if a.profile in HEAVY and not a.yes_i_am_authorised:
        sys.exit(f"'{a.profile}' is a heavy profile: re-run with --yes-i-am-authorised (local replica only).")

    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    run = f"{stamp}-{a.profile}"
    out_host = os.path.join(PERF, "out", run)
    os.makedirs(out_host, exist_ok=True)

    env = dict(os.environ, MOCK_WORKERS=str(a.mock_workers), MOCK_GEN_MS=str(a.mock_gen_ms), MOCK_FAIL_RATE=str(a.mock_fail_rate),
               MOCK_MAX_QUEUE=str(a.mock_max_queue), APACHE_MAX_WORKERS=str(a.app_workers), APACHE_KEEPALIVE=a.keepalive)
    ENV.update(env)
    print(f"[{run}] starting stack (mock workers={a.mock_workers}, gen={a.mock_gen_ms}ms, apache workers={a.app_workers}) ...")
    sh(["docker", "compose", "up", "-d"] + ([] if a.no_restart else ["--force-recreate"]) + ["mock-ai", "app"], env=env)
    sh(["docker", "compose", "up", "-d", "db"], env=env)
    if not wait_ready():
        sys.exit("stack did not become ready")

    # apply the repo's own migrate.php (schema drift between migrations/*.sql and the code) - local DB only
    sh(["docker", "compose", "exec", "-T", "app", "php", "-r", '$_GET["key"]="migrate2025"; chdir("/var/www/html"); require "migrate.php";'], check=False)

    # extra drift the migrate.php run does not cover (see db/schema_drift_patch.sql)
    sh(["docker", "compose", "exec", "-T", "db", "mariadb", "-uroot", "-pperfroot", "tryfit_db"],
       input_=open(os.path.join(PERF, "db", "schema_drift_patch.sql"), encoding="utf8").read())

    # reset test data
    sql("UPDATE merchants SET tryon_count_month=0 WHERE id=1; UPDATE merchants SET tryon_count_month=95 WHERE id=2; "
        "DELETE FROM analytics_daily; DELETE FROM tryon_sessions; FLUSH STATUS;")
    sh(["docker", "compose", "exec", "-T", "app", "sh", "-c", "rm -f /var/www/html/results/* /var/www/html/temp/*.jpg; true"], check=False)
    http_json("http://localhost:4010/__stats")

    pre = {"count_m1": int(sql("SELECT tryon_count_month FROM merchants WHERE id=1")), "count_m2": int(sql("SELECT tryon_count_month FROM merchants WHERE id=2"))}
    mon = Monitor(os.path.join(out_host, "monitor.csv")); mon.start()
    t_start = time.time()

    k6env = {"PROFILE": a.profile, "OUT_DIR": f"/work/out/{run}", "MAX_VUS": a.max_vus, "DUR_SCALE": a.dur_scale, "RATE_SCALE": a.rate_scale,
             "SOAK_MIN": a.soak_min, "EXTRA_POLLS": a.extra_polls, "ONLY": a.only, "WIDGET_EVENT": a.widget_event, "K6_WEB_DASHBOARD": "true",
             "K6_WEB_DASHBOARD_EXPORT": f"/work/out/{run}/dashboard.html"}
    cmd = ["docker", "compose", "--profile", "tools", "run", "--rm", "--no-deps"]
    for k, v in k6env.items():
        cmd += ["-e", f"{k}={v}"]
    cmd += ["k6", "run", "/work/k6/main.js"]
    print(f"[{run}] running k6 profile={a.profile} max_vus={a.max_vus} ...")
    p = subprocess.run(cmd, cwd=PERF, text=True, capture_output=True, env=env)
    open(os.path.join(out_host, "k6_stdout.txt"), "w").write(p.stdout + "\n--- stderr ---\n" + p.stderr)
    t_end = time.time()
    time.sleep(6)
    mon.finish()

    post = {"count_m1": int(sql("SELECT tryon_count_month FROM merchants WHERE id=1")), "count_m2": int(sql("SELECT tryon_count_month FROM merchants WHERE id=2")),
            "analytics_completed": sql("SELECT COALESCE(SUM(tryon_completed),0) FROM analytics_daily"),
            "result_files": sh(["docker", "compose", "exec", "-T", "app", "sh", "-c", "ls /var/www/html/results | wc -l"]).stdout.strip(),
            "db_slow_queries": sql("SHOW GLOBAL STATUS LIKE 'Slow_queries'").split("\t")[-1],
            "db_max_used_connections": sql("SHOW GLOBAL STATUS LIKE 'Max_used_connections'").split("\t")[-1],
            "app_error_log_tail": sh(["docker", "compose", "logs", "--no-log-prefix", "--tail", "15", "app"], check=False).stdout[-1500:]}
    mock = http_json("http://localhost:4010/__stats")
    meta = {"run": run, "profile": a.profile, "integration": "MOCKED (AI provider) / local Docker replica of PHP+MariaDB", "args": vars(a),
            "started": t_start, "ended": t_end, "duration_s": round(t_end - t_start, 1), "k6_exit_code": p.returncode,
            "pre": pre, "post": post, "mock_stats": mock}
    summ = os.path.join(out_host, "summary.json")
    if os.path.exists(summ):
        mm = json.load(open(summ))["metrics"]
        comp = int(mm.get("tryon_completed", {}).get("values", {}).get("count", 0))
        meta["k6_tryon_completed"] = comp
        meta["consistency"] = {
            "merchant1_count_delta": post["count_m1"] - pre["count_m1"], "k6_completed_jobs": comp,
            "double_counted": (post["count_m1"] - pre["count_m1"]) - comp,
            "analytics_completed": post["analytics_completed"],
        }
    json.dump(meta, open(os.path.join(out_host, "meta.json"), "w"), indent=1)

    dest = os.path.join(RESULTS, run)
    shutil.copytree(out_host, dest, dirs_exist_ok=True)
    print(p.stdout[-2500:])
    print(f"[{run}] k6 exit code {p.returncode} (0=thresholds met, 99=thresholds crossed). Results: {dest}")
    if "consistency" in meta:
        print("[consistency]", json.dumps(meta["consistency"]))


if __name__ == "__main__":
    main()
