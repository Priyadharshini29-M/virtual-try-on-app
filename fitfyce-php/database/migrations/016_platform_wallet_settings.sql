-- Wallet rules (credit packs + cost per action) become editable from the VTO
-- platform admin instead of being hard-coded in WalletController::PACKS and
-- WalletCheck::COST_*. Those constants stay as the fallback when a key has
-- no row here, so this migration changes nothing until an admin saves.
CREATE TABLE IF NOT EXISTS platform_settings (
  setting_key  VARCHAR(64)  NOT NULL PRIMARY KEY,   -- wallet.packs | wallet.costs
  value_json   LONGTEXT     NOT NULL,
  updated_by   VARCHAR(190) NULL,                   -- admin e-mail sent by the platform
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB CHARACTER SET utf8mb4;
