-- Local-only "try-on is live" switch for the storefront widget. The old
-- Remix admin stored this in a Shopify metafield (fitfyce.app_enabled);
-- the PHP admin keeps it on the merchant row instead, since we no longer
-- call the Shopify admin API from the admin UI.

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS app_enabled      TINYINT(1) NOT NULL DEFAULT 1 AFTER is_active,
  ADD COLUMN IF NOT EXISTS onboarding_json  LONGTEXT   NULL             AFTER app_enabled;
