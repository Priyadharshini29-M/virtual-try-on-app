export const PHP_API_URL        = process.env.PHP_API_URL        ?? "";
export const PHP_API_SECRET     = process.env.PHP_API_SECRET     ?? "";
export const SHOPIFY_API_KEY    = process.env.SHOPIFY_API_KEY    ?? "";
export const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET ?? "";
export const SHOPIFY_APP_URL    = process.env.SHOPIFY_APP_URL    ?? "";
export const NODE_ENV           = process.env.NODE_ENV           ?? "development";
export const R2_ACCOUNT_ID      = process.env.R2_ACCOUNT_ID      ?? "";
export const R2_ACCESS_KEY      = process.env.R2_ACCESS_KEY      ?? "";
export const R2_SECRET_KEY      = process.env.R2_SECRET_KEY      ?? "";
export const R2_BUCKET          = process.env.R2_BUCKET          ?? "tryfit-uploads";
export const R2_PUBLIC_URL      = process.env.R2_PUBLIC_URL      ?? "";

// AI Studio is held in beta — merchants don't see it until this flag is set
// to "1" / "true" in fly.toml [env]. Internal testers can flip it per-env.
const _studioRaw = (process.env.FEATURE_AI_STUDIO ?? "").toLowerCase().trim();
export const FEATURE_AI_STUDIO  = _studioRaw === "1" || _studioRaw === "true" || _studioRaw === "yes";
