<?php
/**
 * Migration runner — safe to run multiple times (idempotent).
 * Access: https://tryonapp.digifyce.com/migrate.php?key=migrate2025
 * DELETE this file from the server after migrations are applied.
 */
if (($_GET['key'] ?? '') !== 'migrate2025') {
    http_response_code(403);
    exit(json_encode(['error' => 'Forbidden']));
}

header('Content-Type: application/json');

// Load .env — same parser as router.php. migrate.php is a standalone entry
// point (never goes through router.php), so without this AppConfig::dbHost()
// etc. all resolve to '' and Database::getInstance() throws immediately
// (uncaught PDOException -> blank 500, display_errors is off on this host).
$envFile = __DIR__ . '/.env';
if (is_file($envFile)) {
    $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }
        if (strpos($line, '=') !== false) {
            [$k, $v] = explode('=', $line, 2);
            $k = trim($k);
            $v = trim($v);
            if (!isset($_ENV[$k]) && getenv($k) === false) {
                putenv("{$k}={$v}");
                $_ENV[$k] = $v;
            }
        }
    }
}

require_once __DIR__ . '/config/AppConfig.php';
require_once __DIR__ . '/db/Database.php';

$pdo = \TryFit\Db\Database::getInstance();
$log = [];

function runSQL(\PDO $pdo, string $label, string $sql, array &$log): void {
    try {
        $affected = $pdo->exec($sql);
        $log[] = ['ok' => true, 'step' => $label, 'affected' => $affected];
    } catch (\Throwable $e) {
        // PDO getCode() returns SQLSTATE string; MySQL error code is in errorInfo[1]
        $mysqlCode = $e instanceof \PDOException ? (int)($e->errorInfo[1] ?? 0) : 0;
        if (in_array($mysqlCode, [1060, 1061, 1050, 1826], true)) {
            $log[] = ['ok' => true, 'step' => $label, 'note' => 'already exists — skipped'];
        } else {
            $log[] = ['ok' => false, 'step' => $label, 'error' => $e->getMessage(), 'mysqlcode' => $mysqlCode];
        }
    }
}

// ── Core tables: CREATE IF NOT EXISTS (idempotent) ───────────────────────────
runSQL($pdo, 'create tryon_sessions',
    "CREATE TABLE IF NOT EXISTS tryon_sessions (
      id                   CHAR(36) PRIMARY KEY,
      merchant_id          INT UNSIGNED NOT NULL,
      product_id           INT UNSIGNED DEFAULT NULL,
      variant_id           INT UNSIGNED DEFAULT NULL,
      status               ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
      result_image_url     TEXT DEFAULT NULL,
      result_seed          INT DEFAULT NULL,
      result_expires_at    DATETIME DEFAULT NULL,
      error_message        VARCHAR(500) DEFAULT NULL,
      api_request_at       DATETIME DEFAULT NULL,
      api_response_at      DATETIME DEFAULT NULL,
      api_latency_ms       INT UNSIGNED DEFAULT NULL,
      action_add_to_cart   TINYINT(1) NOT NULL DEFAULT 0,
      action_buy_now       TINYINT(1) NOT NULL DEFAULT 0,
      action_save_image    TINYINT(1) NOT NULL DEFAULT 0,
      action_share_wa      TINYINT(1) NOT NULL DEFAULT 0,
      device_type          ENUM('mobile','tablet','desktop') DEFAULT NULL,
      country_code         CHAR(2) DEFAULT NULL,
      created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_merchant_date (merchant_id, created_at),
      INDEX idx_status (status)
    ) ENGINE=InnoDB CHARACTER SET utf8mb4", $log);

// If tryon_sessions already exists, ensure product_id is nullable (allows sessions without synced products)
runSQL($pdo, 'tryon_sessions: make product_id nullable',
    "ALTER TABLE tryon_sessions MODIFY COLUMN product_id INT UNSIGNED DEFAULT NULL", $log);

runSQL($pdo, 'create analytics_daily',
    "CREATE TABLE IF NOT EXISTS analytics_daily (
      id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      merchant_id         INT UNSIGNED NOT NULL,
      date                DATE NOT NULL,
      tryon_initiated     INT UNSIGNED NOT NULL DEFAULT 0,
      tryon_completed     INT UNSIGNED NOT NULL DEFAULT 0,
      tryon_failed        INT UNSIGNED NOT NULL DEFAULT 0,
      add_to_cart_count   INT UNSIGNED NOT NULL DEFAULT 0,
      buy_now_count       INT UNSIGNED NOT NULL DEFAULT 0,
      save_count          INT UNSIGNED NOT NULL DEFAULT 0,
      share_wa_count      INT UNSIGNED NOT NULL DEFAULT 0,
      order_count         INT UNSIGNED NOT NULL DEFAULT 0,
      revenue_inr         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      avg_latency_ms      INT UNSIGNED DEFAULT NULL,
      computed_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                          ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_ad_merchant FOREIGN KEY (merchant_id)
        REFERENCES merchants(id) ON DELETE CASCADE,
      UNIQUE KEY uq_merchant_date (merchant_id, date),
      INDEX idx_date (date)
    ) ENGINE=InnoDB CHARACTER SET utf8mb4", $log);

runSQL($pdo, 'create analytics_webhook_events',
    "CREATE TABLE IF NOT EXISTS analytics_webhook_events (
      id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      webhook_event_id VARCHAR(100) NOT NULL,
      merchant_id      INT UNSIGNED NOT NULL,
      event_type       VARCHAR(64)  NOT NULL,
      processed_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_webhook_event (webhook_event_id),
      INDEX idx_merchant_event (merchant_id, event_type)
    ) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci", $log);

// ── products: add missing columns (migration 011) ─────────────────────────────
runSQL($pdo, 'products: add title',
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS title VARCHAR(500) DEFAULT NULL", $log);
runSQL($pdo, 'products: add handle',
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS handle VARCHAR(500) DEFAULT NULL", $log);
runSQL($pdo, 'products: add image_url',
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT NULL", $log);
runSQL($pdo, 'products: add price',
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS price DECIMAL(10,2) NOT NULL DEFAULT 0.00", $log);

// ── merchant_settings: add missing columns (idempotent) ───────────────────────
runSQL($pdo, 'merchant_settings: add shopify_domain',
    "ALTER TABLE merchant_settings ADD COLUMN shopify_domain VARCHAR(255) DEFAULT NULL AFTER merchant_id", $log);

runSQL($pdo, 'merchant_settings: add shopify_store_id',
    "ALTER TABLE merchant_settings ADD COLUMN shopify_store_id VARCHAR(100) DEFAULT NULL AFTER shopify_domain", $log);

runSQL($pdo, 'merchant_settings: add created_at',
    "ALTER TABLE merchant_settings ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER widget_config", $log);

runSQL($pdo, 'merchant_settings: add updated_at',
    "ALTER TABLE merchant_settings ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at", $log);

// ── Backfill shopify_domain + shopify_store_id for existing rows ──────────────
runSQL($pdo, 'merchant_settings: backfill domain from merchants',
    "UPDATE merchant_settings ms
     JOIN merchants m ON m.id = ms.merchant_id
     SET ms.shopify_domain   = m.shopify_domain,
         ms.shopify_store_id = m.shopify_store_id
     WHERE ms.shopify_domain IS NULL", $log);

// ── analytics_daily: add missing columns ─────────────────────────────────────
runSQL($pdo, 'analytics_daily: add shopify_domain',
    "ALTER TABLE analytics_daily ADD COLUMN shopify_domain VARCHAR(255) DEFAULT NULL AFTER merchant_id", $log);

runSQL($pdo, 'analytics_daily: add shopify_store_id',
    "ALTER TABLE analytics_daily ADD COLUMN shopify_store_id VARCHAR(100) DEFAULT NULL AFTER shopify_domain", $log);

// ── webhook_logs table ────────────────────────────────────────────────────────
runSQL($pdo, 'create webhook_logs',
    "CREATE TABLE IF NOT EXISTS webhook_logs (
        id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        merchant_id     INT NOT NULL,
        event_type      VARCHAR(64) NOT NULL,
        direction       ENUM('incoming','outgoing') NOT NULL DEFAULT 'incoming',
        payload         LONGTEXT NOT NULL,
        headers         LONGTEXT DEFAULT NULL,
        response_status INT DEFAULT NULL,
        error_message   TEXT DEFAULT NULL,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_wl_merchant (merchant_id),
        INDEX idx_wl_event    (event_type),
        INDEX idx_wl_created  (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci", $log);

// ── Migration 006: plan rebrand (basic / pro / premium) ──────────────────────
runSQL($pdo, '006: merchants plan enum expand',
    "ALTER TABLE merchants MODIFY COLUMN plan ENUM('free','starter','growth','scale','basic','pro','premium') NOT NULL DEFAULT 'free'", $log);
runSQL($pdo, '006: map free/starter → basic',
    "UPDATE merchants SET plan = 'basic' WHERE plan IN ('free','starter')", $log);
runSQL($pdo, '006: map growth → pro',
    "UPDATE merchants SET plan = 'pro' WHERE plan = 'growth'", $log);
runSQL($pdo, '006: map scale → premium',
    "UPDATE merchants SET plan = 'premium' WHERE plan = 'scale'", $log);
runSQL($pdo, '006: merchants plan enum finalize',
    "ALTER TABLE merchants MODIFY COLUMN plan ENUM('basic','pro','premium') NOT NULL DEFAULT 'basic'", $log);
runSQL($pdo, '006: create plan_limits',
    "CREATE TABLE IF NOT EXISTS plan_limits (
        plan                 ENUM('basic','pro','premium') PRIMARY KEY,
        monthly_tryon_limit  INT UNSIGNED NOT NULL,
        max_products         INT UNSIGNED NOT NULL,
        analytics_enabled    TINYINT(1) NOT NULL DEFAULT 0,
        custom_api_enabled   TINYINT(1) NOT NULL DEFAULT 0,
        branding_removable   TINYINT(1) NOT NULL DEFAULT 0,
        share_enabled        TINYINT(1) NOT NULL DEFAULT 1,
        price_inr_monthly    INT UNSIGNED NOT NULL DEFAULT 0
    ) ENGINE=InnoDB CHARACTER SET utf8mb4", $log);
runSQL($pdo, '006: upsert plan_limits basic',
    "INSERT INTO plan_limits VALUES ('basic',100,1,0,0,0,1,0)
     ON DUPLICATE KEY UPDATE monthly_tryon_limit=100,max_products=1,analytics_enabled=0", $log);
runSQL($pdo, '006: upsert plan_limits pro',
    "INSERT INTO plan_limits VALUES ('pro',2000,0,1,0,1,1,1499)
     ON DUPLICATE KEY UPDATE monthly_tryon_limit=2000,max_products=0,analytics_enabled=1", $log);
runSQL($pdo, '006: upsert plan_limits premium',
    "INSERT INTO plan_limits VALUES ('premium',10000,0,1,1,1,1,3999)
     ON DUPLICATE KEY UPDATE monthly_tryon_limit=10000,max_products=0,analytics_enabled=1", $log);

// ── Migration 007: shop meta columns + collections tables ─────────────────────
runSQL($pdo, '007: merchants add shopify_plan',
    "ALTER TABLE merchants ADD COLUMN IF NOT EXISTS shopify_plan VARCHAR(100) NULL", $log);
runSQL($pdo, '007: merchants add installed_theme_name',
    "ALTER TABLE merchants ADD COLUMN IF NOT EXISTS installed_theme_name VARCHAR(255) NULL", $log);
runSQL($pdo, '007: merchants add installed_theme_id',
    "ALTER TABLE merchants ADD COLUMN IF NOT EXISTS installed_theme_id BIGINT UNSIGNED NULL", $log);
runSQL($pdo, '007: create collections',
    "CREATE TABLE IF NOT EXISTS collections (
        id                      INT UNSIGNED NOT NULL AUTO_INCREMENT,
        merchant_id             INT UNSIGNED NOT NULL,
        shopify_collection_id   BIGINT UNSIGNED NOT NULL,
        shopify_collection_gid  VARCHAR(100) NOT NULL,
        title                   VARCHAR(500) NOT NULL,
        handle                  VARCHAR(500) NOT NULL,
        products_count          INT UNSIGNED NOT NULL DEFAULT 0,
        created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_merchant_collection (merchant_id, shopify_collection_id)
    ) ENGINE=InnoDB CHARACTER SET utf8mb4", $log);
runSQL($pdo, '007: create product_collection_map',
    "CREATE TABLE IF NOT EXISTS product_collection_map (
        product_id    INT UNSIGNED NOT NULL,
        collection_id INT UNSIGNED NOT NULL,
        PRIMARY KEY (product_id, collection_id)
    ) ENGINE=InnoDB CHARACTER SET utf8mb4", $log);

// ── Migration 008: widget settings columns ────────────────────────────────────
runSQL($pdo, '008: merchant_settings add widget_language',
    "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS widget_language VARCHAR(10) NOT NULL DEFAULT 'en'", $log);
runSQL($pdo, '008: add widget_subtitle',
    "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS widget_subtitle VARCHAR(200) NULL", $log);
runSQL($pdo, '008: add button_border_radius',
    "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS button_border_radius INT UNSIGNED NOT NULL DEFAULT 8", $log);
runSQL($pdo, '008: add hover_bg_color',
    "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS hover_bg_color VARCHAR(7) NOT NULL DEFAULT '#F3F4F6'", $log);
runSQL($pdo, '008: add button_width',
    "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS button_width INT UNSIGNED NOT NULL DEFAULT 0", $log);
runSQL($pdo, '008: add button_height',
    "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS button_height INT UNSIGNED NOT NULL DEFAULT 0", $log);
runSQL($pdo, '008: add title_font_size',
    "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS title_font_size INT UNSIGNED NOT NULL DEFAULT 20", $log);
runSQL($pdo, '008: add subtitle_font_size',
    "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS subtitle_font_size INT UNSIGNED NOT NULL DEFAULT 14", $log);
runSQL($pdo, '008: add title_font_weight',
    "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS title_font_weight VARCHAR(10) NOT NULL DEFAULT '600'", $log);
runSQL($pdo, '008: add title_font_family',
    "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS title_font_family VARCHAR(100) NOT NULL DEFAULT 'Inter, sans-serif'", $log);
runSQL($pdo, '008: add subtitle_font_family',
    "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS subtitle_font_family VARCHAR(100) NOT NULL DEFAULT 'Inter, sans-serif'", $log);
runSQL($pdo, '008: add button_icon',
    "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS button_icon VARCHAR(30) NOT NULL DEFAULT 'eye'", $log);
runSQL($pdo, '008: add icon_color',
    "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS icon_color VARCHAR(7) NOT NULL DEFAULT '#FFFFFF'", $log);
runSQL($pdo, '008: add main_icon_bg_color',
    "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS main_icon_bg_color VARCHAR(20) NOT NULL DEFAULT 'transparent'", $log);
runSQL($pdo, '008: add coll_icon_bg_color',
    "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS coll_icon_bg_color VARCHAR(20) NOT NULL DEFAULT 'transparent'", $log);
runSQL($pdo, '008: add icon_size',
    "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS icon_size INT UNSIGNED NOT NULL DEFAULT 16", $log);
runSQL($pdo, '008: add icon_radius',
    "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS icon_radius INT UNSIGNED NOT NULL DEFAULT 4", $log);
runSQL($pdo, '008: add icon_shape',
    "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS icon_shape VARCHAR(20) NOT NULL DEFAULT 'square'", $log);
runSQL($pdo, '008: add icon_opacity',
    "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS icon_opacity INT UNSIGNED NOT NULL DEFAULT 100", $log);
runSQL($pdo, '008: add show_on_collection',
    "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS show_on_collection TINYINT(1) NOT NULL DEFAULT 1", $log);
runSQL($pdo, '008: add collection_position',
    "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS collection_position ENUM('top_left','top_right','bottom_left','bottom_right') NOT NULL DEFAULT 'top_right'", $log);

// ── widget_config JSON column (used by WidgetSettingsRepo) ────────────────────
runSQL($pdo, 'merchant_settings: add widget_config',
    "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS widget_config LONGTEXT NULL", $log);
runSQL($pdo, 'merchant_settings: add products_json',
    "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS products_json LONGTEXT NULL", $log);
runSQL($pdo, 'merchant_settings: add enabled_products',
    "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS enabled_products LONGTEXT NULL", $log);

// ── Migration 009: merchant_id on variant_image_mappings ──────────────────────
runSQL($pdo, '009: variant_image_mappings add merchant_id',
    "ALTER TABLE variant_image_mappings ADD COLUMN IF NOT EXISTS merchant_id INT UNSIGNED NOT NULL DEFAULT 0", $log);
runSQL($pdo, '009: variant_image_mappings backfill merchant_id',
    "UPDATE variant_image_mappings vim
     INNER JOIN products p ON p.id = vim.product_id
     SET vim.merchant_id = p.merchant_id
     WHERE vim.merchant_id = 0", $log);

// ── Backfill analytics_daily domain columns for existing rows ─────────────────
runSQL($pdo, 'analytics_daily: backfill shopify_domain + store_id',
    "UPDATE analytics_daily ad
     JOIN merchants m ON m.id = ad.merchant_id
     SET ad.shopify_domain   = m.shopify_domain,
         ad.shopify_store_id = m.shopify_store_id
     WHERE ad.shopify_domain IS NULL", $log);

// ── Migration 012: garment_type on variant_image_mappings ────────────────────
runSQL($pdo, '012: variant_image_mappings add garment_type',
    "ALTER TABLE variant_image_mappings ADD COLUMN IF NOT EXISTS garment_type ENUM('top','bottom','full') NOT NULL DEFAULT 'top' AFTER image_type", $log);

// ── Migration 013: avatar_sex, clothing_prompt, is_approved ──────────────────
runSQL($pdo, '013: variant_image_mappings add avatar_sex',
    "ALTER TABLE variant_image_mappings ADD COLUMN IF NOT EXISTS avatar_sex ENUM('male','female') DEFAULT NULL AFTER garment_type", $log);
runSQL($pdo, '013: variant_image_mappings add clothing_prompt',
    "ALTER TABLE variant_image_mappings ADD COLUMN IF NOT EXISTS clothing_prompt VARCHAR(200) DEFAULT NULL AFTER avatar_sex", $log);
runSQL($pdo, '013: variant_image_mappings add is_approved',
    "ALTER TABLE variant_image_mappings ADD COLUMN IF NOT EXISTS is_approved TINYINT(1) NOT NULL DEFAULT 1 AFTER clothing_prompt", $log);
runSQL($pdo, '013: merchant_settings add show_watermark',
    "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS show_watermark TINYINT(1) NOT NULL DEFAULT 1", $log);
runSQL($pdo, '013: merchant_settings add share_whatsapp_enabled',
    "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS share_whatsapp_enabled TINYINT(1) NOT NULL DEFAULT 1", $log);
runSQL($pdo, '013: merchant_settings add save_image_enabled',
    "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS save_image_enabled TINYINT(1) NOT NULL DEFAULT 1", $log);
runSQL($pdo, '013: merchant_settings add privacy_notice_shown',
    "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS privacy_notice_shown TINYINT(1) NOT NULL DEFAULT 1", $log);

// ── Migration 014: product RAG fact columns + vector_index_status ────────────
runSQL($pdo, '014: products add vendor',
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS vendor VARCHAR(255) DEFAULT NULL", $log);
runSQL($pdo, '014: products add product_type',
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type VARCHAR(255) DEFAULT NULL", $log);
runSQL($pdo, '014: products add tags',
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS tags TEXT DEFAULT NULL", $log);
runSQL($pdo, '014: products add description_html',
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS description_html LONGTEXT DEFAULT NULL", $log);
runSQL($pdo, '014: create vector_index_status',
    "CREATE TABLE IF NOT EXISTS vector_index_status (
        id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        merchant_id   INT UNSIGNED NOT NULL,
        collection    VARCHAR(64)  NOT NULL DEFAULT 'fitfyce_knowledge',
        source_type   VARCHAR(32)  NOT NULL,
        source_id     VARCHAR(64)  NOT NULL,
        content_hash  CHAR(40)     NOT NULL,
        chunk_count   INT UNSIGNED NOT NULL DEFAULT 0,
        updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_vector_source (collection, merchant_id, source_type, source_id),
        KEY idx_vector_merchant (merchant_id)
    ) ENGINE=InnoDB CHARACTER SET utf8mb4", $log);

// ── Final: show merchant_settings with domain populated ──────────────────────
$rows = $pdo->query(
    "SELECT id, merchant_id, shopify_domain, shopify_store_id, created_at FROM merchant_settings ORDER BY id"
)->fetchAll();

$allOk = !in_array(false, array_column($log, 'ok'), true);

echo json_encode([
    'all_ok'            => $allOk,
    'migrations'        => $log,
    'merchant_settings' => $rows,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
