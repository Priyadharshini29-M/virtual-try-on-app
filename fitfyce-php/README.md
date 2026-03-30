# TryFit PHP Backend

## Setup

1. Copy `.env.example` to `.env`, fill in DB vars and API key:
   ```
   cp .env.example .env
   ```

2. Run migrations in order:
   ```
   mysql -u root -p < database/migrations/001_merchants.sql
   mysql -u root -p < database/migrations/002_products.sql
   mysql -u root -p < database/migrations/003_sessions.sql
   mysql -u root -p < database/migrations/004_analytics.sql
   mysql -u root -p < database/migrations/005_plan_limits.sql
   ```

3. Verify DB connection:
   ```
   php -r "require 'db/Database.php'; \$db = TryFit\Db\Database::getInstance(); echo 'DB OK';"
   ```

4. Ensure `results/` and `temp/` directories are web-accessible and writable:
   ```
   mkdir -p results temp temp/.meta
   chmod 755 results temp temp/.meta
   ```

5. Set crontab for cleanup:
   ```
   0 * * * * php /path/to/fitfyce-php/cron/cleanup_results.php >> /dev/null 2>&1
   ```

## Testing new routes

```bash
# Should return 401 Unauthorized (correct — no merchant with that key)
curl -X POST https://yourserver.com/session/create \
  -H "X-Api-Key: test_key" \
  -H "Content-Type: application/json" \
  -d '{"product_id":1,"variant_id":1,"device_type":"mobile"}'

# Check plan limit
curl -X GET https://yourserver.com/plan/limit \
  -H "X-Api-Key: YOUR_KEY"

# Get settings
curl -X GET https://yourserver.com/settings \
  -H "X-Api-Key: YOUR_KEY"
```

## Existing try-on endpoint (unchanged)

```
POST https://yourserver.com/ with { clothing_image, avatar_image }
```

The router only intercepts new routes. If no route matches, execution falls through
to the original `api.php` try-on logic exactly as before.

## Directory structure

```
fitfyce-php/
├── api.php                    # Original try-on endpoint (+ router hook at top)
├── router.php                 # Route dispatcher
├── shared/helpers.php         # Shared helper functions
├── db/                        # Database layer
│   ├── Database.php           # PDO singleton
│   ├── MerchantRepo.php
│   ├── SessionRepo.php
│   ├── ProductRepo.php
│   └── AnalyticsRepo.php
├── middleware/
│   ├── CorsMiddleware.php
│   ├── ApiKeyAuth.php
│   └── PlanLimitCheck.php
├── controllers/
│   ├── SessionController.php
│   ├── SettingsController.php
│   ├── ProductController.php
│   ├── AnalyticsController.php
│   ├── ConversionController.php
│   ├── PlanController.php
│   └── UploadController.php
├── database/migrations/       # SQL schema files (001-005)
├── cron/cleanup_results.php   # Hourly cleanup job
├── src/                       # Original VTON classes (do not modify)
├── results/                   # Generated try-on images (web-accessible)
└── temp/                      # Temporary uploaded photos (10-min TTL)
    └── .meta/                 # Expiry metadata JSON files
```
