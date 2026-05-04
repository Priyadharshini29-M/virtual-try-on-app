CREATE TABLE merchants (

id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

-- Shopify identity

shopify_domain VARCHAR(255) NOT NULL UNIQUE,

shopify_store_id VARCHAR(100) NOT NULL UNIQUE,

-- Auth

access_token TEXT NOT NULL,

-- Plans

plan ENUM('basic','pro','premium') NOT NULL DEFAULT 'basic',

shopify_plan VARCHAR(100) NULL,

-- Theme info

installed_theme_name VARCHAR(255) NULL,

installed_theme_id BIGINT UNSIGNED NULL,

-- API credentials (for external/internal use)

api_key VARCHAR(64) NOT NULL UNIQUE,

api_secret VARCHAR(64) NOT NULL,

-- Usage tracking (future-ready, keep it)

tryon_count_month INT UNSIGNED NOT NULL DEFAULT 0,

billing_cycle_start DATE NULL,

-- Status

is_active TINYINT(1) NOT NULL DEFAULT 1,

-- Timestamps

created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

-- Indexes

INDEX idx_domain (shopify_domain),

INDEX idx_api_key (api_key),

INDEX idx_plan (plan),

INDEX idx_active (is_active)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE products (

id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

-- Relation

merchant_id INT UNSIGNED NOT NULL,

-- Shopify identifiers

shopify_product_id BIGINT UNSIGNED NOT NULL,

shopify_product_gid VARCHAR(100) NOT NULL,

-- Product data

title VARCHAR(500) NOT NULL,

handle VARCHAR(500) NOT NULL,

-- 🔥 Collection stored inline

collection_id BIGINT UNSIGNED NULL,

collection_handle VARCHAR(255) NULL,

collection_title VARCHAR(255) NULL,

-- Optional: multiple collections (JSON)

collections_json JSON NULL,

-- Feature flag

is_tryon_enabled TINYINT(1) NOT NULL DEFAULT 1,

-- Timestamps

created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

-- Constraints

CONSTRAINT fk_products_merchant

FOREIGN KEY (merchant_id)

REFERENCES merchants(id)

ON DELETE CASCADE,

-- Uniqueness

UNIQUE KEY uq_merchant_product (merchant_id, shopify_product_id),

-- Indexes

INDEX idx_merchant (merchant_id),

INDEX idx_collection (collection_id),

INDEX idx_enabled (merchant_id, is_tryon_enabled)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE merchant_settings (
id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

-- Relation (1:1 with merchants)
merchant_id INT UNSIGNED NOT NULL,

-- ======================
-- TEXT CONTENT
-- ======================
button_text VARCHAR(100) NOT NULL DEFAULT 'Try On This Look',
widget_subtitle VARCHAR(200) NULL,

-- ======================
-- COLORS & STYLE
-- ======================
button_color VARCHAR(7) NOT NULL DEFAULT '#111827',
button_text_color VARCHAR(7) NOT NULL DEFAULT '#FFFFFF',
hover_bg_color VARCHAR(7) NOT NULL DEFAULT '#F3F4F6',

button_border_radius INT UNSIGNED NOT NULL DEFAULT 8,

-- ======================
-- DIMENSIONS
-- ======================
button_width INT UNSIGNED NOT NULL DEFAULT 0,
button_height INT UNSIGNED NOT NULL DEFAULT 0,

-- ======================
-- SPACING
-- ======================
button_padding_top INT UNSIGNED NOT NULL DEFAULT 10,
button_padding_right INT UNSIGNED NOT NULL DEFAULT 24,
button_padding_bottom INT UNSIGNED NOT NULL DEFAULT 10,
button_padding_left INT UNSIGNED NOT NULL DEFAULT 24,

button_margin_top INT UNSIGNED NOT NULL DEFAULT 0,
button_margin_right INT UNSIGNED NOT NULL DEFAULT 0,
button_margin_bottom INT UNSIGNED NOT NULL DEFAULT 0,
button_margin_left INT UNSIGNED NOT NULL DEFAULT 0,

-- ======================
-- TYPOGRAPHY
-- ======================
title_font_size INT UNSIGNED NOT NULL DEFAULT 20,
subtitle_font_size INT UNSIGNED NOT NULL DEFAULT 14,

title_font_weight VARCHAR(10) NOT NULL DEFAULT '600',

title_font_family VARCHAR(100) NOT NULL DEFAULT 'Inter, sans-serif',
subtitle_font_family VARCHAR(100) NOT NULL DEFAULT 'Inter, sans-serif',

-- ======================
-- ICON SETTINGS
-- ======================
button_icon VARCHAR(30) NOT NULL DEFAULT 'eye',
icon_color VARCHAR(7) NOT NULL DEFAULT '#FFFFFF',

main_icon_bg_color VARCHAR(20) NOT NULL DEFAULT 'transparent',
coll_icon_bg_color VARCHAR(20) NOT NULL DEFAULT 'transparent',

icon_size INT UNSIGNED NOT NULL DEFAULT 16,
icon_radius INT UNSIGNED NOT NULL DEFAULT 4,
icon_shape VARCHAR(20) NOT NULL DEFAULT 'square',
icon_opacity INT UNSIGNED NOT NULL DEFAULT 100,

-- ======================
-- COLLECTION DISPLAY
-- ======================
show_on_collection TINYINT(1) NOT NULL DEFAULT 1,
collection_position ENUM('top_left','top_right','bottom_left','bottom_right')
NOT NULL DEFAULT 'top_right',

-- ======================
-- FEATURES
-- ======================
show_watermark TINYINT(1) NOT NULL DEFAULT 1,
share_whatsapp_enabled TINYINT(1) NOT NULL DEFAULT 1,
save_image_enabled TINYINT(1) NOT NULL DEFAULT 1,
privacy_notice_shown TINYINT(1) NOT NULL DEFAULT 1,

-- ======================
-- LOCALIZATION
-- ======================
widget_language VARCHAR(10) NOT NULL DEFAULT 'en',

-- ======================
-- (LEGACY / OPTIONAL)
-- ======================
button_position ENUM('below_images','below_atc','floating')
NOT NULL DEFAULT 'below_images',

-- ======================
-- TIMESTAMPS
-- ======================
created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
ON UPDATE CURRENT_TIMESTAMP,

-- ======================
-- CONSTRAINTS
-- ======================
CONSTRAINT fk_settings_merchant
FOREIGN KEY (merchant_id)
REFERENCES merchants(id)
ON DELETE CASCADE,

UNIQUE KEY uq_merchant_settings (merchant_id),
INDEX idx_merchant (merchant_id)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;