# TryFit — Shopify App (Remix / React Router)

Virtual try-on Shopify app for apparel D2C brands.

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in all values:
   ```
   cp .env.example .env
   ```

3. Run Prisma migrations (Shopify session storage):
   ```
   npx prisma migrate dev
   ```

4. Start the dev server with Shopify tunnel:
   ```
   shopify app dev
   ```

5. Install on a dev store via the Shopify CLI prompt.

## Environment variables

| Variable         | Description                                              |
|------------------|----------------------------------------------------------|
| `SHOPIFY_API_KEY`    | From your Shopify Partner app                        |
| `SHOPIFY_API_SECRET` | From your Shopify Partner app                        |
| `SHOPIFY_APP_URL`    | Your ngrok / Fly.io / Render URL                     |
| `PHP_API_URL`        | Your PHP server base URL (never exposed to browser)  |
| `PHP_API_SECRET`     | Merchant API key used by the Remix server to call PHP |
| `R2_*`               | Cloudflare R2 for temp photo storage (optional, falls back to PHP temp/) |

## Theme extension

After running `shopify app dev`:

1. Generate the extension (first time only):
   ```
   shopify app generate extension --type theme_app_extension --name tryon-widget
   ```

2. In the Shopify Theme Editor, add the **TryFit Try-On Button** block to your product template.

3. The widget reads variant mappings from `product.metafields.tryfit.variant_mappings`.

## Route structure

| Route                   | Description                                       |
|-------------------------|---------------------------------------------------|
| `/app`                  | Dashboard with KPI cards and 7-day chart         |
| `/app/products`         | Enable/disable try-on per product                |
| `/app/variants`         | Map variant images for try-on                    |
| `/app/settings`         | Widget appearance settings                       |
| `/app/analytics`        | Analytics with date range selector               |
| `/api/tryon`            | Server proxy → PHP try-on (35s timeout)          |
| `/api/upload`           | Server proxy → R2 or PHP temp upload             |
| `/api/track`            | Server proxy → PHP session tracking              |
| `/api/webhook`          | Handles orders/paid and app/uninstalled webhooks |

## Webhooks

Registered automatically via `shopify.app.toml`:
- `orders/paid` → attributes conversions to try-on sessions
- `app/uninstalled` → deactivates merchant

## Data flow

```
Storefront widget
  → /api/upload  (Remix server)  → R2 or PHP /upload-temp
  → /api/tryon   (Remix server)  → PHP api.php (try-on processing)
  → /api/track   (Remix server)  → PHP /session/track
```

The PHP server URL is never exposed to the browser.
