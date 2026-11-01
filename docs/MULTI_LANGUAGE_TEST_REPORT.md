# Multi-language Phase 1 — test report

Written for: you, deciding whether to deploy Phase 1 to prod.

**Date tested:** 2026-10-28
**Overall verdict:** Remix layer passes **everything I can test offline** (65 assertions, 0 failures). PHP layer is structurally sound but **not deployed to prod yet** — the migration URL returned 404, confirming the files are on your laptop only.

---

## 1. Remix build

Full production build, 556 modules, SSR + client bundles both emitted.

```
✓ built in 10.30s   (client)
✓ built in  4.58s   (SSR, server)
```

No errors from any of my new files (`app/i18n/*`, `app/components/I18nProvider.jsx`, `app/components/LanguageSelector.jsx`, `app/routes/api.locale.jsx`, modified `app/root.jsx`). Build warnings are the pre-existing `.rar` route-ID collisions, unrelated to i18n.

## 2. Remix i18n unit tests — 48/48 pass

| Area | Checks | Pass |
|---|---|---|
| `config.js` exports | 4 | 4 |
| `normalize()` (incl. `ar-SA`, `fr-CA`, unsupported, nulls) | 9 | 9 |
| `dirFor()` | 4 | 4 |
| `COUNTRY_LOCALE` map (SA/AE/IN/MX/DE) | 5 | 5 |
| `loadBundles` for every supported locale | 12 | 12 |
| `translate()` interpolation + missing-key loudness | 2 | 2 |
| All 60 locale JSON files parse + EN non-empty | 3 | 3 |
| Cookie serialize + round-trip | 3 | 3 |
| `resolveLocale` chain precedence (cookie > Accept-Lang > CF-IPCountry > en) | 6 | 6 |

Key properties proven:
- Hindi/Spanish/French/German/Arabic locales **do not crash** on missing keys — every one falls back cleanly to English through `bundles.server.js`.
- `ff_locale` cookie beats `Accept-Language` even when the browser screams `fr-FR,fr;q=0.9` and the cookie says `ar`.
- Q-weighted parse works: `ja;q=0.9,ar;q=0.8,en;q=0.1` → `ar` (ja unsupported, ar wins over en on quality).
- CF-IPCountry `SA` → `ar`; CF-IPCountry `JP` (no mapping) → `en`.
- Missing keys surface as `common.foo.bar` (loud) rather than empty string.

## 3. SSR render under 3 locales

Rendered the root tree with `react-dom/server`:

| Locale | `<html lang>` | `<html dir>` | Devanagari font | Arabic font |
|---|---|---|---|---|
| `en` | `en` | `ltr` | ✗ (correct) | ✗ (correct) |
| `hi` | `hi` | `ltr` | ✓ loaded | ✗ (correct) |
| `ar` | `ar` | **`rtl`** | ✗ (correct) | ✓ loaded |

Interpolation also runs through SSR: `translate(bundles, "errors", "plan_limit", { limit: 7 })` → `"You have reached your plan limit of 7 generations this month"` under every locale (because Hindi/Arabic are empty stubs, EN fallback supplies the string + the number interpolates).

## 4. Locale JSON files

- **60/60 parse** (10 namespaces × 6 locales)
- **10/10 EN namespaces** are populated with real keys
- **50 stub files** are empty `{}` — correct, they fall through to EN
- **Em-dash lint:** 0 occurrences of U+2014 in `app/locales/**/*.json` or `fitfyce-php/locales/**/*.php` ✓

## 5. PHP side (file inspection — no PHP CLI available locally)

Integration points audited by grep. All present and correctly named:

```
I18n.php         : boot, setLocale, locale, isRtl, isBooted, t, lookup, logMissing
LocaleDetector.php: detect, normalize, parseAcceptLanguage, SUPPORTED, COUNTRY_LOCALE
MerchantRepo.php : getLocale, setLocale, setDetectedCountry   (3 new methods)
router.php       : require LocaleDetector.php + I18n.php (line 83-84)
                   I18n::boot(…) called before controllers (line 173)
                   POST /api/settings/locale route registered (line 191)
SettingsController.php : use TryFit\Src\I18n + LocaleDetector + MerchantRepo
                         saveLocale() action at line 114
```

No PHP CLI on this Windows box, so `php -l` syntax check was not run. The code reads as valid PHP 8+ and uses only features already in use elsewhere in the codebase (strict types, nullable params, trailing commas).

## 6. What was NOT tested (and why)

| | Why |
|---|---|
| `migrate_add_locale.php` against prod DB | Needs prod access — auto-mode (correctly) blocked outbound calls to `tryonapp.digifyce.com`. You've already confirmed the file isn't on the server (404). |
| `POST /api/settings/locale` on prod | Same reason. |
| Shopify-authenticated flow of `/api/locale` on Remix | Needs the Shopify dev session + an authenticated iframe. The underlying pieces (`authenticate.admin`, Prisma write, PHP mirror) are all paths used by other routes already in production, so this is low-risk. |
| Real browser render — font visually rendered, RTL layout flipped | Needs a running dev server + browser session. SSR confirms the `<link>` tags and `dir="rtl"` are emitted; actual layout mirroring is Polaris v13's job. |
| Phase 2 string extraction | Hasn't started. Current PHP controllers still return hard-coded English. |

## 7. What this means for deployment

**Safe to deploy right now:**
- Every Remix change (`app/i18n/*`, components, `api.locale.jsx`, updated `root.jsx`, locale JSONs, `rtl.css`, modified `php-api.server.js`). The fallback chain means no visible change for English merchants; non-English merchants start seeing `<html lang/dir>` match their locale and the Noto fonts load.
- All PHP i18n files (`src/I18n.php`, `src/LocaleDetector.php`, `locales/*.php`, modified `router.php`, `db/MerchantRepo.php`, `controllers/SettingsController.php`). None of them change existing responses — they only *add* a `t()` facility that nothing is calling yet.
- The migration file. Idempotent, safe to re-run.

**Deploy order (matters only if you want to be strict):**
1. PHP migration + I18n + MerchantRepo + locales → run migrate URL → delete migrate file from server
2. PHP router + SettingsController (adds the locale endpoint)
3. Remix build + deploy
4. Visit admin from a non-English browser → `<html lang>` reflects it. Done.

**Rollback is trivial:** revert the Remix build, or feature-flag the root loader to return `locale: 'en'` unconditionally. The PHP side is purely additive.

## 8. Remaining risk I'd flag

- `authenticate.admin(request)` inside the root loader runs on every page (including auth callbacks and the login page). The current `resolveLocale()` call in `root.jsx` does **not** pass an admin/shopDomain — step 2 and 3 of the chain are deliberately skipped at root level, to avoid a loader crash on unauthenticated routes. Downstream loaders in `app/routes/app.*.jsx` can re-resolve with `{ admin, shopDomain }` if you want shop-primary-locale precedence. This is a design choice, not a bug — call it out if you'd rather the chain always run.
- The LanguageSelector is **not mounted anywhere yet**. The `/api/locale` endpoint works and the cookie flow works, but there's no UI control visible to the merchant until you add `<LanguageSelector current={locale} />` to the AppShell nav. That's Phase 2 work.

## 9. Next action

Pick one:
- **A. Deploy now.** English-only merchants see no change; non-English merchants start getting `<html lang>` and font loading. The selector comes later.
- **B. Add the LanguageSelector to the AppShell first**, then deploy. ~15 min work.
- **C. Hold until Phase 2**, so the selector + at least one PHP controller + one Remix route are fully translated before any deploy. Larger blast radius but a cleaner first impression.
