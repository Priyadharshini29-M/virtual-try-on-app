"""Builds db/init.sql = repo migrations (in order) + synthetic test seed. Read-only on the repo."""
import glob, os
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
mig = sorted(glob.glob(os.path.join(ROOT, "fitfyce-php", "database", "migrations", "*.sql")))
SEED = """
-- ===== synthetic test data (no real merchants / customers) =====
USE tryfit_db;
INSERT INTO merchants (shopify_domain, shopify_store_id, access_token, plan, api_key, api_secret, tryon_count_month, billing_cycle_start, is_active)
VALUES
 ('perf-test.myshopify.com',  'perf-store-1', 'not-a-real-token', 'premium', 'tf_perf_test_key_0001',  'perf-secret-1', 0,  CURDATE(), 1),
 ('perf-quota.myshopify.com', 'perf-store-2', 'not-a-real-token', 'basic',   'tf_perf_quota_key_0002', 'perf-secret-2', 95, CURDATE(), 1);
INSERT IGNORE INTO merchant_settings (merchant_id) SELECT id FROM merchants;
"""
out = os.path.join(HERE, "..", "db", "init.sql")
with open(out, "w", encoding="utf8") as f:
    for p in mig:
        f.write(f"\n-- ===== {os.path.basename(p)} =====\nUSE tryfit_db;\n")
        f.write(open(p, encoding="utf8").read() + "\n")
    f.write(SEED)
print("wrote", os.path.normpath(out), "from", len(mig), "migrations")
