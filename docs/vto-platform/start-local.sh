#!/usr/bin/env bash
# Local dev runner (Git Bash on Windows). Starts MariaDB 10.11 (port 3307) if it is not up,
# then the PHP 8.3 built-in server on http://localhost:8080 with the vto/ folder as docroot.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
RT=/c/vto-runtime

if ! "$RT/mariadb/bin/mariadb-admin.exe" -uroot -pvto_root_local -P3307 -h127.0.0.1 ping >/dev/null 2>&1; then
  echo "starting MariaDB on :3307"
  "$RT/mariadb/bin/mysqld.exe" --defaults-file=C:/vto-runtime/mariadb-data/my.ini >/dev/null 2>&1 &
  for i in $(seq 1 20); do "$RT/mariadb/bin/mariadb-admin.exe" -uroot -pvto_root_local -P3307 -h127.0.0.1 ping >/dev/null 2>&1 && break; sleep 1; done
fi

export VTO_BASE_URL=http://localhost:8080 VTO_DEV_ALLOW_PRIVATE=1 PHP_CLI_SERVER_WORKERS=4
export VTO_DB_PORT=3307 VTO_DB_USER=vto_user VTO_DB_PASS=vto_local_pass
# FitFyce backend the button design is read from (local FitFyce dev server; production default is https://tryonapp.digifyce.com)
export VTO_FITFYCE_API="${VTO_FITFYCE_API:-http://localhost:8000}"
# Stores + wallets sync: must equal VTO_PLATFORM_SECRET in fitfyce-php/.env.local (kept outside the repo)
[ -z "$VTO_PLATFORM_SECRET" ] && [ -f "$RT/platform_secret.txt" ] && export VTO_PLATFORM_SECRET="$(cat "$RT/platform_secret.txt")"
# The Windows built-in server has a single worker (no fork), so tryon.php cannot fetch the
# product image from itself. Demo images are served by a second process acting as the store's CDN,
# bound to IPv4 because the SSRF guard pins the IPv4 address it resolved.
"$RT/php/php.exe" -S 127.0.0.1:8081 -t "$HERE/vto" >/dev/null 2>&1 &
trap 'kill $! 2>/dev/null' EXIT

# Bind IPv4 explicitly: on Windows "localhost" binds ::1 only, which Scrapy (127.0.0.1) cannot reach.
# Browsers still use http://localhost:8080, so the widget Origin matches the site domain "localhost".
echo "VTO on http://localhost:8080  (admin: http://localhost:8080/admin/)  image CDN on :8081"
"$RT/php/php.exe" -S 127.0.0.1:8080 -t "$HERE/vto"
