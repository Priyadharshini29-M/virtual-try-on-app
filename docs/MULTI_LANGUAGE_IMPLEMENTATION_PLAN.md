# FitFyce Merchant Backend — Automatic Multi-Language Implementation Plan

**Target:** Production-ready auto language switching for the merchant admin (same UX pattern as Shopify's auto currency detection).

**Scope:** The merchant-facing admin UI inside Shopify (`fitfyce-shopify/app/`, React Router v7 + Polaris) and the PHP API strings it consumes (`fitfyce-php/`). The storefront try-on widget is **out of scope** for this document.

**Launch locales:** `en`, `hi`, `es`, `fr`, `de`, `ar` (6 — covers ~85% of Shopify merchant distribution).

---

## 1. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (Shopify admin iframe)                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ React Router v7 app                                 │    │
│  │  • i18next + react-i18next                          │    │
│  │  • Namespace per route group                        │    │
│  │  • Locale resolved in root loader                   │    │
│  └───────┬─────────────────────────────────────────────┘    │
│          │ Accept-Language: hi-IN                           │
│          │ Cookie: ff_locale=hi                             │
└──────────┼──────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  Remix server (loader/action)                               │
│   • resolveLocale(request, session)                         │
│   • Loads namespace JSONs from app/locales/<lng>/<ns>.json  │
│   • Writes ff_locale cookie                                 │
│   • Forwards Accept-Language to PHP API calls               │
└──────────┬──────────────────────────────────────────────────┘
           │ Accept-Language: hi
           ▼
┌─────────────────────────────────────────────────────────────┐
│  PHP API (fitfyce-php)                                      │
│   • I18n::boot($shopId) in router.php                       │
│   • t('errors.plan_limit') returns localized string         │
│   • Locale persisted in merchants.locale column             │
└─────────────────────────────────────────────────────────────┘
```

**Why two layers:** The Remix admin owns 95% of visible strings; the PHP side owns error payloads, email templates, PDF exports (Garment Studio reports), and anything served directly from PHP routes (standalone-tryon, cron summaries).

---

## 2. Automatic detection algorithm

Runs once per session. Result cached in `ff_locale` cookie (1 year) and `merchants.locale` column. Short-circuits on first match.

| Order | Source | How it's read | Notes |
|---|---|---|---|
| 1 | `ff_locale` cookie | `request.headers.cookie` | User override from language selector, highest priority |
| 2 | `merchants.locale` | Prisma / `MerchantRepo::getLocale($shopId)` | Server-side memory for merchants who already used the app |
| 3 | Shopify shop locale | `shop.primaryLocale` from `admin.graphql('{ shop { primaryLocale } }')` | Reflects the merchant's chosen Shopify admin language |
| 4 | `Accept-Language` header | Standard HTTP parse, best-quality match | Falls back when no shop locale is available (e.g. embedded iframe without full auth yet) |
| 5 | IP → country → language | Cloudflare `CF-IPCountry` header or one `ipapi.co` call cached forever on the merchant row | Only runs if 1-4 all fail |
| 6 | Default `en` | Hard-coded fallback | |

After the first successful resolution, step 1 wins on every subsequent request. Shopify-locale changes are picked up at next sign-in (we clear `ff_locale` on OAuth callback so step 3 re-runs).

**Supported-locale guard:** Any detected locale not in `SUPPORTED_LOCALES` collapses to its base (`fr-CA` → `fr`), then to `en` if still unsupported. Prevents a loader crash from a `zh-TW` browser.

---

## 3. Database schema change

Single additive migration — no destructive edits.

**File:** `fitfyce-php/migrate_add_locale.php`
```sql
ALTER TABLE merchants
  ADD COLUMN locale VARCHAR(5) NOT NULL DEFAULT 'en'
  AFTER shop_domain;

ALTER TABLE merchants
  ADD COLUMN locale_detected_country VARCHAR(2) NULL
  AFTER locale;

CREATE INDEX idx_merchants_locale ON merchants(locale);
```

**Prisma schema** (`fitfyce-shopify/prisma/schema.prisma`): if the Remix app has its own merchant model, mirror the two columns there and run `prisma migrate dev --name add_locale`.

**Backfill:** none — new column defaults to `en`, auto-detection fills it on next request per merchant.

---

## 4. Deliverables (every file to create or modify)

### 4.1 Remix admin — new files

```
fitfyce-shopify/app/
├── i18n/
│   ├── config.js                 # supported locales, namespaces, fallback
│   ├── resolve.server.js         # detection chain (steps 1-6)
│   ├── server.js                 # i18next server instance factory
│   ├── client.js                 # i18next browser instance factory
│   ├── cookie.server.js          # ff_locale cookie (signed, 1 year)
│   └── useT.js                   # thin useTranslation re-export
├── locales/
│   ├── en/
│   │   ├── common.json           # nav, buttons, generic errors
│   │   ├── settings.json         # app.settings.jsx
│   │   ├── products.json         # app.products.jsx, app.variants.jsx
│   │   ├── studio.json           # app.studio.*, Garment Studio
│   │   ├── analytics.json
│   │   ├── onboarding.json
│   │   ├── plans.json
│   │   ├── complete-look.json
│   │   ├── size-chart.json
│   │   └── errors.json           # standard PHP API error codes → messages
│   ├── hi/   (same 10 files)
│   ├── es/   (same 10 files)
│   ├── fr/   (same 10 files)
│   ├── de/   (same 10 files)
│   └── ar/   (same 10 files)
├── components/
│   ├── LanguageSelector.jsx      # Polaris Select in AppShell header
│   └── I18nProvider.jsx          # wraps <I18nextProvider> + <Dir> for RTL
└── styles/
    └── rtl.css                   # mirror overrides for Arabic
```

**Dependencies to add** (`fitfyce-shopify/package.json`):
```json
"i18next": "^23.15.0",
"react-i18next": "^15.0.0",
"i18next-browser-languagedetector": "^8.0.0",
"accept-language-parser": "^1.5.0"
```

### 4.2 Remix admin — modified files

| File | Change |
|---|---|
| `app/root.jsx` | Add `loader` that calls `resolveLocale(request)`, returns `{ locale, dir, bundles }`. Wrap `<Outlet/>` in `<I18nProvider locale={locale} bundles={bundles}>`. Set `<html lang={locale} dir={dir}>`. |
| `app/routes/app.jsx` | Add `<LanguageSelector/>` to the Polaris `AppProvider` nav. Thread locale into the PHP fetch helper. |
| `app/lib/api.server.js` (or wherever PHP calls originate) | Add `Accept-Language: <locale>` header to every outgoing fetch to `fitfyce-php`. |
| `app/entry.server.jsx` | Initialise server-side i18next instance per request before rendering. |
| Every `app/routes/app.*.jsx` and child component | Replace hard-coded strings with `const { t } = useTranslation('<namespace>')` and `t('key')`. |

### 4.3 PHP API — new files

```
fitfyce-php/
├── src/
│   ├── I18n.php                  # boot, t(), setLocale, getLocale, isRtl
│   └── LocaleDetector.php        # 6-step chain mirrored on the PHP side
├── locales/
│   ├── en.php
│   ├── hi.php
│   ├── es.php
│   ├── fr.php
│   ├── de.php
│   └── ar.php
└── migrate_add_locale.php        # the ALTER TABLE above
```

### 4.4 PHP API — modified files

| File | Change |
|---|---|
| `router.php` | After `.env` load, call `I18n::boot(shopIdFromRequest(), $_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? null)`. Precedence: request header > cookie > merchant row > shop locale > IP > `en`. |
| `db/MerchantRepo.php` | Add `getLocale(string $shopId): string` and `setLocale(string $shopId, string $locale): void`. |
| `controllers/SettingsController.php` | Replace hard-coded response strings with `t('settings.*')`. Add `POST /api/settings/locale` endpoint for the language selector. |
| `controllers/GarmentStudioController.php` | `t('garment_studio.*')` for all merchant-visible messages (success/error/validation). PDF report headings localized via same `t()`. |
| `controllers/TryOnController.php` | Error payloads (`invalid_image`, `no_face_detected`, etc.) → `t('errors.tryon.*')`. |
| `controllers/UploadController.php` | File-size / mime-type error strings. |
| `controllers/InfographicController.php` | AI-generated infographic captions optionally prompt-translated (see §7). |
| `controllers/WidgetController.php` | Admin-side widget config error messages (storefront widget strings itself stay out of scope). |
| `controllers/ShopifySyncController.php` | On install callback, fetch `shop.primaryLocale`, call `MerchantRepo::setLocale`, clear `ff_locale` cookie. |
| `controllers/PlanController.php` | Plan name / limit-exceeded strings. |
| `controllers/OnboardingController.php` | Onboarding step copy. |
| `middleware/PlanLimitCheck.php` | 402 response body localized. |
| `cron/cleanup_results.php` | Any email-notification bodies localized to the merchant's `locale`. |

---

## 5. Code specifications (the pieces that are not obvious)

### 5.1 `app/i18n/config.js`
```js
export const SUPPORTED_LOCALES = ['en', 'hi', 'es', 'fr', 'de', 'ar'];
export const DEFAULT_LOCALE = 'en';
export const RTL_LOCALES = new Set(['ar']);
export const NAMESPACES = [
  'common', 'settings', 'products', 'studio', 'analytics',
  'onboarding', 'plans', 'complete-look', 'size-chart', 'errors'
];

export function normalize(tag) {
  if (!tag) return DEFAULT_LOCALE;
  const base = tag.toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LOCALES.includes(base) ? base : DEFAULT_LOCALE;
}

export const isRtl = (l) => RTL_LOCALES.has(l);
```

### 5.2 `app/i18n/resolve.server.js` (the detection chain)
```js
import { parse } from 'accept-language-parser';
import { getLocaleCookie, setLocaleCookie } from './cookie.server.js';
import { normalize, DEFAULT_LOCALE } from './config.js';
import prisma from '../db.server.js';

export async function resolveLocale(request, { shopDomain, admin } = {}) {
  // 1. Cookie
  const cookieLocale = await getLocaleCookie(request);
  if (cookieLocale) return normalize(cookieLocale);

  // 2. Merchant row
  if (shopDomain) {
    const row = await prisma.merchant.findUnique({
      where: { shopDomain },
      select: { locale: true },
    });
    if (row?.locale) return normalize(row.locale);
  }

  // 3. Shopify shop locale
  if (admin) {
    try {
      const res = await admin.graphql(`{ shop { primaryLocale } }`);
      const data = (await res.json()).data;
      if (data?.shop?.primaryLocale) return normalize(data.shop.primaryLocale);
    } catch { /* fall through */ }
  }

  // 4. Accept-Language
  const acceptLang = request.headers.get('accept-language');
  if (acceptLang) {
    const picked = parse(acceptLang)[0]?.code;
    if (picked) return normalize(picked);
  }

  // 5. IP country via Cloudflare header
  const country = request.headers.get('cf-ipcountry');
  if (country) return normalize(countryToLocale(country));

  // 6. Default
  return DEFAULT_LOCALE;
}

const COUNTRY_LOCALE = {
  IN: 'hi', ES: 'es', MX: 'es', AR: 'es', CO: 'es',
  FR: 'fr', BE: 'fr', CH: 'fr',
  DE: 'de', AT: 'de',
  SA: 'ar', AE: 'ar', EG: 'ar', MA: 'ar',
};
function countryToLocale(cc) { return COUNTRY_LOCALE[cc.toUpperCase()] || 'en'; }
```

### 5.3 `app/root.jsx` loader additions
```js
export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request).catch(() => ({}));
  const locale = await resolveLocale(request, { shopDomain: session?.shop, admin });

  // Preload only the namespaces the first render needs; others lazy-load.
  const bundles = await loadBundles(locale, ['common', 'errors']);

  const headers = new Headers();
  await setLocaleCookie(headers, locale);

  return json(
    { locale, dir: isRtl(locale) ? 'rtl' : 'ltr', bundles },
    { headers }
  );
}
```

### 5.4 `fitfyce-php/src/I18n.php`
```php
<?php
declare(strict_types=1);

class I18n {
    private static string $locale = 'en';
    private static array $strings = [];
    private const SUPPORTED = ['en','hi','es','fr','de','ar'];
    private const RTL = ['ar'];

    public static function boot(?string $shopId, ?string $acceptLang = null): void {
        $locale = LocaleDetector::detect($shopId, $acceptLang);
        if (!in_array($locale, self::SUPPORTED, true)) $locale = 'en';
        self::$locale = $locale;
        self::$strings = require __DIR__ . "/../locales/{$locale}.php";
    }

    public static function t(string $key, array $params = []): string {
        $parts = explode('.', $key);
        $val = self::$strings;
        foreach ($parts as $p) {
            if (!is_array($val) || !array_key_exists($p, $val)) return $key;
            $val = $val[$p];
        }
        if (!is_string($val)) return $key;
        foreach ($params as $k => $v) $val = str_replace('{' . $k . '}', (string)$v, $val);
        return $val;
    }

    public static function locale(): string { return self::$locale; }
    public static function isRtl(): bool { return in_array(self::$locale, self::RTL, true); }
}

function t(string $key, array $params = []): string { return I18n::t($key, $params); }
```

### 5.5 Locale file shape (`locales/en.php`)
```php
<?php return [
    'common' => [
        'save' => 'Save',
        'cancel' => 'Cancel',
        'loading' => 'Loading...',
    ],
    'settings' => [
        'title' => 'Settings',
        'save_success' => 'Settings saved',
        'save_error' => 'Could not save settings: {reason}',
    ],
    'errors' => [
        'plan_limit' => 'You have reached your plan limit of {limit} generations this month',
        'tryon' => [
            'no_face_detected' => 'No face detected in the uploaded photo',
            'invalid_image' => 'The image could not be read',
        ],
    ],
    // ...one top-level key per controller namespace
];
```

### 5.6 Language selector component
```jsx
// app/components/LanguageSelector.jsx
import { useTranslation } from 'react-i18next';
import { Select } from '@shopify/polaris';
import { useFetcher } from 'react-router';
import { SUPPORTED_LOCALES } from '../i18n/config.js';

const LABELS = { en: 'English', hi: 'हिन्दी', es: 'Español',
                 fr: 'Français', de: 'Deutsch', ar: 'العربية' };

export function LanguageSelector({ current }) {
  const fetcher = useFetcher();
  return (
    <Select
      label=""
      labelHidden
      value={current}
      options={SUPPORTED_LOCALES.map(l => ({ label: LABELS[l], value: l }))}
      onChange={(value) => {
        fetcher.submit({ locale: value }, { method: 'post', action: '/api/locale' });
        // reload after the cookie is set so SSR picks up the new bundle
        setTimeout(() => window.location.reload(), 100);
      }}
    />
  );
}
```

### 5.7 Locale write endpoint
```js
// app/routes/api.locale.jsx
export async function action({ request }) {
  const form = await request.formData();
  const locale = normalize(form.get('locale'));
  const { session } = await authenticate.admin(request);

  await prisma.merchant.update({
    where: { shopDomain: session.shop },
    data: { locale },
  });

  // Mirror to PHP side so API responses switch immediately too.
  await fetch(`${PHP_BASE}/api/settings/locale`, {
    method: 'POST',
    headers: { 'X-Shop-Id': session.shop, 'Accept-Language': locale },
    body: JSON.stringify({ locale }),
  });

  const headers = new Headers();
  await setLocaleCookie(headers, locale);
  return json({ ok: true }, { headers });
}
```

---

## 6. String extraction workflow

Each controller/route pair is one extraction unit. Procedure per unit:

1. Grep the file for user-visible strings (JSX text nodes, `throw new Error('...')`, `return json({ message: '...' })`, Polaris `Banner`/`Toast` content, button labels, placeholders, aria labels).
2. Replace each with `t('<namespace>.<descriptive_key>')`.
3. Add the key to `locales/en/<namespace>.json` (Remix) or `locales/en.php` (PHP).
4. Run the "missing-keys" lint (§8.2) to confirm no hard-coded strings remain.
5. Translate the new keys into all 5 other locales (§7).

**Namespace mapping (final):**

| Namespace | Owns strings from |
|---|---|
| `common` | AppShell nav, buttons, generic Yes/No/Save/Cancel, dates, numbers |
| `settings` | `app.settings.jsx`, `SettingsController` |
| `products` | `app.products.jsx`, `app.variants.jsx`, `ProductController` |
| `studio` | `app.studio.*`, `GarmentStudioController`, `StudioV2Controller`, `TryOnController` |
| `analytics` | `app.analytics.jsx`, `AnalyticsController` |
| `onboarding` | `app.onboarding-status.jsx`, `OnboardingController` |
| `plans` | `app.plans.jsx`, `PlanController`, `PlanLimitCheck` |
| `complete-look` | `app.complete-look.jsx`, `CompleteLookController` |
| `size-chart` | `app.size-chart.jsx`, `SizeChartController` |
| `errors` | Every error payload returned by any PHP controller, grouped by controller sub-key |

**String key convention:** `snake_case`, descriptive, never English-dependent. `settings.save_success`, not `settings.settings_saved_toast`.

**Interpolation:** always `{name}` (not `{{name}}`). Numeric formatting via `Intl.NumberFormat(locale)`, dates via `Intl.DateTimeFormat(locale)`.

**Pluralization:** use `i18next` built-in rules: `settings.generations_count_one` / `_other` / `_zero` (etc.). For PHP, add a `tp($key, $n)` helper on `I18n` with CLDR plural rules via `intl` extension.

---

## 7. Translation production

**Primary:** DeepL API (`deepl-node`), one-shot batch of all `en` keys → 5 other locales. Preserves `{placeholders}` by default.

**Secondary quality pass:** GPT-4 with the prompt "Review these translations as a native speaker of {locale} in a Shopify merchant admin context. Fix anything that reads as machine-translated. Keep placeholders exactly."

**Mandatory human review:**
- Billing/plan copy (`plans.*`) — misunderstandings cost money
- Error messages (`errors.*`) — must be unambiguous for support tickets
- Onboarding (`onboarding.*`) — first impression

**No em dashes** per [feedback_no_em_dashes.md](C:\Users\Admin\.claude\projects\d--Digifyce-FitFyce-FitFyce\memory\feedback_no_em_dashes.md). Add a CI lint that fails if any `locales/**/*.{json,php}` file contains `—` (U+2014).

**Translation workflow script:** `scripts/translate.mjs`
```
input:  app/locales/en/*.json
output: app/locales/{hi,es,fr,de,ar}/*.json
checks: placeholder count parity, em-dash absence, no empty values
```

**AI-generated content (Infographic captions, product descriptions):** pass the detected locale into the OpenAI prompt as `Respond in {locale}` — the prompt layer handles it, no post-translation needed.

---

## 8. Quality gates (must pass before production)

### 8.1 Automated
- **TypeScript / lint:** zero errors
- **i18next-parser dry run:** no untranslated keys, no orphan keys, placeholder parity across all locales
- **Em-dash lint:** `grep -nP '\x{2014}' locales/` returns nothing in any locale
- **RTL smoke test:** Playwright run of 6 key routes in `ar` locale confirms layout doesn't break (no horizontal scroll, nav mirrored, icons flipped where needed)
- **PHP unit tests:** `I18n::t()` returns key on missing translation, interpolates placeholders, falls back to `en` on unknown locale
- **Fallback test:** every non-English locale file falls back to `en` for missing keys (no raw key strings visible to merchants)

### 8.2 Manual
- Walk through every route in each of the 6 locales with a native speaker checklist
- Verify Shopify embedded iframe honors `<html lang>` and `dir` (App Bridge sometimes overrides)
- Confirm PDF exports (Garment Studio reports) use correct fonts for Hindi + Arabic
- Verify emails from `cron/cleanup_results.php` arrive in merchant's locale
- Test language selector persists across sign-out / sign-in

### 8.3 Performance
- Preloaded namespaces (`common`, `errors`) < 15 KB gzipped per locale
- Lazy namespaces load in < 200 ms on 4G
- No locale bundle imported by root (would ship all 6 to every merchant)

---

## 9. Typography, RTL, fonts

### 9.1 Fonts
Hindi (Devanagari) and Arabic need webfonts. Shopify Polaris ships only Latin.

Add to `app/root.jsx` `<Links>`:
```jsx
{locale === 'hi' && <link rel="stylesheet"
   href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600&display=swap"/>}
{locale === 'ar' && <link rel="stylesheet"
   href="https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;500;600&display=swap"/>}
```

CSS override in `app/styles/i18n-fonts.css`:
```css
html[lang="hi"] { font-family: 'Noto Sans Devanagari', 'Inter', sans-serif; }
html[lang="ar"] { font-family: 'Noto Sans Arabic', 'Inter', sans-serif; }
```

### 9.2 RTL
`app/styles/rtl.css` loaded only when `dir="rtl"`:
```css
html[dir="rtl"] .Polaris-Navigation { right: 0; left: auto; }
html[dir="rtl"] .Polaris-Icon--toneBase { transform: scaleX(-1); }
/* flip arrow icons, chevrons, progress bars */
```

Avoid `logical properties` CSS rewrite — Polaris already uses them, so most layout mirrors for free.

### 9.3 PDF exports
Garment Studio report PDFs (`GarmentStudioController` → DomPDF/mPDF/whatever): embed DejaVu Sans or Noto Sans fonts bundled under `fitfyce-php/assets/fonts/`. Add font registration in the PDF generation path, selected by `I18n::locale()`.

---

## 10. Caching strategy

- **Locale JSON bundles** served with `Cache-Control: public, max-age=3600, stale-while-revalidate=86400` and hashed filenames (`common.<hash>.json`) so cache busts automatically on deploy.
- **`ff_locale` cookie:** signed with `SESSION_SECRET`, `SameSite=Lax`, `Secure`, 1 year.
- **PHP `I18n::$strings`:** stored on the request only; no need for a shared cache since locale files are tiny PHP arrays (opcache handles them).
- **Shopify shop locale (step 3):** cached per request only. Re-fetched on install callback.
- **IP country (step 5):** cached forever on `merchants.locale_detected_country`. Only re-run if the country column is `NULL`.

---

## 11. Deployment & rollout

**Deployment order (critical — do not reorder):**
1. Deploy PHP migration (`migrate_add_locale.php`) — adds columns, no behavioral change
2. Deploy PHP `I18n.php` + `LocaleDetector.php` + all `locales/*.php` — API still returns English because callers haven't been updated yet
3. Deploy PHP controller changes (every `t()` call) — API now returns localized strings, but Remix is still English, so merchants see English (safe)
4. Deploy Remix i18n infrastructure + all locale JSONs + updated routes — merchants see localized UI
5. Enable language selector in nav

**Feature flag (`FEATURE_I18N`)** on step 4 only, so a quick rollback is `FEATURE_I18N=0` without reverting commits. Flag defaults to `on` for all merchants on day 1 — no cohort rollout needed because the fallback chain guarantees English is always valid.

**Rollback plan:** `FEATURE_I18N=0` → Remix forces `locale='en'`, PHP continues emitting whatever locale the request asked for but Remix ignores it. Zero data loss. The `merchants.locale` column stays populated for the eventual re-enable.

---

## 12. Monitoring

Add three metrics (whatever analytics layer the app uses — looks like `AnalyticsRepo`):

| Metric | Why |
|---|---|
| `i18n.detected_locale` (counter, tag: `locale`) | Confirms detection distribution matches merchant country distribution |
| `i18n.override_locale` (counter, tag: `from`→`to`) | High override rate = bad default detection |
| `i18n.missing_key` (counter, tag: `locale`, `key`) | A translation gap in production |

Set up a daily cron that scans the log for `i18n.missing_key` and files them to a sheet for the translation workflow to pick up.

---

## 13. Maintenance process

**Adding a new string:**
1. Add key to `en.json` / `en.php`
2. Run `npm run translate` — DeepL fills all 5 locales
3. Open a PR; a native-speaker reviewer confirms the translation
4. CI verifies placeholder parity + no em dashes

**Adding a new locale:**
1. Add to `SUPPORTED_LOCALES` in both `config.js` and `I18n.php`
2. Add to `COUNTRY_LOCALE` map in `resolve.server.js` and `LocaleDetector.php` for any countries it should auto-detect in
3. Add Google Fonts link + CSS font-family if the script needs one
4. Add to `RTL_LOCALES` if right-to-left
5. Run `npm run translate -- --target=<locale>` to populate all bundles
6. Add to the LanguageSelector `LABELS` map with the locale's own name

**Removing a locale:** reverse of above; detection falls back to `en` for merchants whose locale was removed.

---

## 14. Effort estimate

| Workstream | Hours |
|---|---|
| PHP infrastructure (`I18n`, `LocaleDetector`, migration, router hook) | 6 |
| PHP controller string extraction (10 controllers) | 10 |
| Remix infrastructure (i18n setup, loader, provider, selector) | 8 |
| Remix route string extraction (20 routes + shared components) | 16 |
| Translation production (DeepL batch + GPT-4 polish, 6 locales × 10 namespaces) | 4 |
| Native-speaker review (plans / errors / onboarding only) | varies — budget 2 h per locale × 5 = 10 h |
| RTL CSS + font loading | 4 |
| PDF export font embedding | 3 |
| QA (automated + manual) | 8 |
| Monitoring + maintenance scripts | 3 |
| **Total** | **~72 hours** |

---

## 15. Out of scope (explicit)

- Storefront try-on widget (customer-facing, separate plan)
- AI-generated image overlays (not text, no translation needed)
- Shopify embedded App Bridge toasts (inherit from browser automatically)
- Translating merchant-authored product descriptions / titles (that's Shopify's own Translate & Adapt app)

---

## 16. Acceptance criteria

The feature ships to production when:

1. A merchant signing in from `*.myshopify.com` with Hindi set as their Shopify admin language sees the full FitFyce admin in Hindi without any manual toggle
2. Switching the language selector from Hindi to Spanish updates every string in the UI within one page reload
3. API error messages from PHP arrive in the merchant's locale
4. The Garment Studio PDF export renders Hindi / Arabic characters correctly
5. The Arabic locale shows a fully mirrored (RTL) layout
6. A merchant whose browser is set to a locale we don't support (e.g. Japanese) sees English without any broken strings
7. No raw `translation.key.like.this` strings are visible anywhere in any locale
8. The language selector choice persists across sign-out and sign-in
9. All automated quality gates (§8.1) pass in CI
10. Monitoring dashboards show `i18n.missing_key` at 0 for 7 consecutive days post-launch
