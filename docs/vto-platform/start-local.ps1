# Local dev runner for Windows PowerShell. Same as start-local.sh:
# MariaDB 10.11 on :3307 (started if not up), image CDN on 127.0.0.1:8081, VTO on http://localhost:8080
$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$rt = 'C:\vto-runtime'

& "$rt\mariadb\bin\mariadb-admin.exe" --user=root --password=vto_root_local --host=127.0.0.1 --port=3307 ping 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'starting MariaDB on :3307'
    Start-Process -FilePath "$rt\mariadb\bin\mysqld.exe" -ArgumentList '--defaults-file=C:/vto-runtime/mariadb-data/my.ini' -WindowStyle Hidden
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Seconds 1
        & "$rt\mariadb\bin\mariadb-admin.exe" --user=root --password=vto_root_local --host=127.0.0.1 --port=3307 ping 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { break }
    }
}

$env:VTO_BASE_URL = 'http://localhost:8080'
$env:VTO_DEV_ALLOW_PRIVATE = '1'
$env:VTO_DB_PORT = '3307'
$env:VTO_DB_USER = 'vto_user'
$env:VTO_DB_PASS = 'vto_local_pass'
# FitFyce backend the button design is read from (local FitFyce dev server; production default is https://tryonapp.digifyce.com)
if (-not $env:VTO_FITFYCE_API) { $env:VTO_FITFYCE_API = 'http://localhost:8000' }
# Stores + wallets sync: must equal VTO_PLATFORM_SECRET in fitfyce-php/.env.local (kept outside the repo)
if (-not $env:VTO_PLATFORM_SECRET -and (Test-Path "$rt\platform_secret.txt")) { $env:VTO_PLATFORM_SECRET = (Get-Content "$rt\platform_secret.txt" -Raw).Trim() }

# Windows php -S has a single worker, so tryon.php cannot fetch images from itself: demo images come from :8081
$cdn = Start-Process -FilePath "$rt\php\php.exe" -ArgumentList '-S', '127.0.0.1:8081', '-t', "`"$here\vto`"" -WindowStyle Hidden -PassThru
try {
    Write-Host 'VTO on http://localhost:8080  (admin: http://localhost:8080/admin/)  image CDN on :8081  - Ctrl+C to stop'
    # IPv4 bind: on Windows "localhost" binds ::1 only, which Scrapy and the SSRF-pinned fetch cannot reach
    & "$rt\php\php.exe" -S 127.0.0.1:8080 -t "$here\vto"
} finally {
    Stop-Process -Id $cdn.Id -ErrorAction SilentlyContinue
}
