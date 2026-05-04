# Database Schema

Complete CREATE TABLE statements reflecting the final schema after all migrations (001–009).
Tables are listed in foreign-key dependency order.

---

## 1. merchants

```sql
CREATE TABLE merchants (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shopify_domain       VARCHAR(255)    NOT NULL UNIQUE,
  shopify_store_id     VARCHAR(100)    NOT NULL UNIQUE,
  access_token         TEXT            NOT NULL,
  plan                 ENUM('basic','pro','premium') NOT NULL DEFAULT 'basic',
  shopify_plan         VARCHAR(100)    NULL,
  installed_theme_name VARCHAR(255)    NULL,
  installed_theme_id   BIGINT UNSIGNED NULL,
  api_key              VARCHAR(64)     NOT NULL UNIQUE,
  api_secret           VARCHAR(64)     NOT NULL,
  tryon_count_month    INT UNSIGNED    NOT NULL DEFAULT 0,
  billing_cycle_start  DATE,
  is_active            TINYINT(1)      NOT NULL DEFAULT 1,
  created_at           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_api_key (api_key),
  INDEX idx_domain  (shopify_domain)
) ENGINE=InnoDB CHARACTER SET utf8mb4;
```

---

## 2. plan_limits

```sql
CREATE TABLE plan_limits (
  plan                ENUM('basic','pro','premium') PRIMARY KEY,
  monthly_tryon_limit INT UNSIGNED NOT NULL,
  max_products        INT UNSIGNED NOT NULL,
  analytics_enabled   TINYINT(1)   NOT NULL DEFAULT 0,
  custom_api_enabled  TINYINT(1)   NOT NULL DEFAULT 0,
  branding_removable  TINYINT(1)   NOT NULL DEFAULT 0,
  share_enabled       TINYINT(1)   NOT NULL DEFAULT 1,
  price_inr_monthly   INT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB CHARACTER SET utf8mb4;

INSERT INTO plan_limits VALUES
  ('basic',   100,   1, 0, 0, 0, 1,    0),
  ('pro',    2000,   0, 1, 0, 1, 1, 1499),
  ('premium',10000,  0, 1, 1, 1, 1, 3999);
```

---

## 3. merchant_settings

```sql
CREATE TABLE merchant_settings (
  id                       INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  merchant_id              INT UNSIGNED   NOT NULL,
  -- Text
  button_text              VARCHAR(100)   NOT NULL DEFAULT 'Try On This Look',
  widget_subtitle          VARCHAR(200)   NULL,
  -- Colors & shape
  button_color             VARCHAR(7)     NOT NULL DEFAULT '#111827',
  button_text_color        VARCHAR(7)     NOT NULL DEFAULT '#FFFFFF',
  button_border_radius     INT UNSIGNED   NOT NULL DEFAULT 8,
  hover_bg_color           VARCHAR(7)     NOT NULL DEFAULT '#F3F4F6',
  -- Dimensions
  button_width             INT UNSIGNED   NOT NULL DEFAULT 0,
  button_height            INT UNSIGNED   NOT NULL DEFAULT 0,
  -- Padding
  button_padding_top       INT UNSIGNED   NOT NULL DEFAULT 10,
  button_padding_right     INT UNSIGNED   NOT NULL DEFAULT 24,
  button_padding_bottom    INT UNSIGNED   NOT NULL DEFAULT 10,
  button_padding_left      INT UNSIGNED   NOT NULL DEFAULT 24,
  -- Margin
  button_margin_top        INT UNSIGNED   NOT NULL DEFAULT 0,
  button_margin_right      INT UNSIGNED   NOT NULL DEFAULT 0,
  button_margin_bottom     INT UNSIGNED   NOT NULL DEFAULT 0,
  button_margin_left       INT UNSIGNED   NOT NULL DEFAULT 0,
  -- Typography
  title_font_size          INT UNSIGNED   NOT NULL DEFAULT 20,
  subtitle_font_size       INT UNSIGNED   NOT NULL DEFAULT 14,
  title_font_weight        VARCHAR(10)    NOT NULL DEFAULT '600',
  title_font_family        VARCHAR(100)   NOT NULL DEFAULT 'Inter, sans-serif',
  subtitle_font_family     VARCHAR(100)   NOT NULL DEFAULT 'Inter, sans-serif',
  -- Legacy position (not used by settings UI)
  button_position          ENUM('below_images','below_atc','floating') NOT NULL DEFAULT 'below_images',
  -- Localisation
  widget_language          VARCHAR(10)    NOT NULL DEFAULT 'en',
  -- Collection icon
  button_icon              VARCHAR(30)    NOT NULL DEFAULT 'eye',
  icon_color               VARCHAR(7)     NOT NULL DEFAULT '#FFFFFF',
  main_icon_bg_color       VARCHAR(20)    NOT NULL DEFAULT 'transparent',
  coll_icon_bg_color       VARCHAR(20)    NOT NULL DEFAULT 'transparent',
  icon_size                INT UNSIGNED   NOT NULL DEFAULT 16,
  icon_radius              INT UNSIGNED   NOT NULL DEFAULT 4,
  icon_shape               VARCHAR(20)    NOT NULL DEFAULT 'square',
  icon_opacity             INT UNSIGNED   NOT NULL DEFAULT 100,
  show_on_collection       TINYINT(1)     NOT NULL DEFAULT 1,
  collection_position      ENUM('top_left','top_right','bottom_left','bottom_right') NOT NULL DEFAULT 'top_right',
  -- Features
  show_watermark           TINYINT(1)     NOT NULL DEFAULT 1,
  share_whatsapp_enabled   TINYINT(1)     NOT NULL DEFAULT 1,
  save_image_enabled       TINYINT(1)     NOT NULL DEFAULT 1,
  privacy_notice_shown     TINYINT(1)     NOT NULL DEFAULT 1,
  -- Timestamps
  created_at               DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ms_merchant FOREIGN KEY (merchant_id)
    REFERENCES merchants(id) ON DELETE CASCADE,
  UNIQUE KEY uq_merchant_settings (merchant_id)
) ENGINE=InnoDB CHARACTER SET utf8mb4;
```

---

## 4. products

```sql
CREATE TABLE products (
  id                   INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY,
  merchant_id          INT UNSIGNED    NOT NULL,
  shopify_product_id   BIGINT UNSIGNED NOT NULL,
  shopify_product_gid  VARCHAR(100)    NOT NULL,
  title                VARCHAR(500)    NOT NULL,
  handle               VARCHAR(500)    NOT NULL,
  is_tryon_enabled     TINYINT(1)      NOT NULL DEFAULT 1,
  created_at           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_p_merchant FOREIGN KEY (merchant_id)
    REFERENCES merchants(id) ON DELETE CASCADE,
  UNIQUE KEY uq_merchant_product (merchant_id, shopify_product_id),
  INDEX idx_enabled (merchant_id, is_tryon_enabled)
) ENGINE=InnoDB CHARACTER SET utf8mb4;
```

---

## 5. collections

```sql
CREATE TABLE collections (
  id                      INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  merchant_id             INT UNSIGNED    NOT NULL,
  shopify_collection_id   BIGINT UNSIGNED NOT NULL,
  shopify_collection_gid  VARCHAR(100)    NOT NULL,
  title                   VARCHAR(500)    NOT NULL,
  handle                  VARCHAR(500)    NOT NULL,
  products_count          INT UNSIGNED    NOT NULL DEFAULT 0,
  created_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_merchant_collection (merchant_id, shopify_collection_id),
  CONSTRAINT fk_collections_merchant FOREIGN KEY (merchant_id)
    REFERENCES merchants(id) ON DELETE CASCADE
) ENGINE=InnoDB CHARACTER SET utf8mb4;
```

---

## 6. product_collection_map

```sql
CREATE TABLE product_collection_map (
  product_id    INT UNSIGNED NOT NULL,
  collection_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (product_id, collection_id),
  CONSTRAINT fk_pcm_product    FOREIGN KEY (product_id)
    REFERENCES products(id)    ON DELETE CASCADE,
  CONSTRAINT fk_pcm_collection FOREIGN KEY (collection_id)
    REFERENCES collections(id) ON DELETE CASCADE
) ENGINE=InnoDB CHARACTER SET utf8mb4;
```

---

## 7. variant_image_mappings

```sql
CREATE TABLE variant_image_mappings (
  id                    INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY,
  merchant_id           INT UNSIGNED    NOT NULL,
  product_id            INT UNSIGNED    NOT NULL,
  shopify_variant_id    BIGINT UNSIGNED NOT NULL,
  shopify_variant_gid   VARCHAR(100)    NOT NULL,
  variant_title         VARCHAR(255)    DEFAULT NULL,
  tryon_image_url       TEXT            NOT NULL,
  image_type            ENUM('flat_lay','ghost_mannequin','on_model') NOT NULL DEFAULT 'flat_lay',
  avatar_sex            ENUM('male','female')  DEFAULT NULL,
  clothing_prompt       VARCHAR(500)    DEFAULT NULL,
  is_approved           TINYINT(1)      NOT NULL DEFAULT 1,
  created_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_vim_merchant FOREIGN KEY (merchant_id)
    REFERENCES merchants(id) ON DELETE CASCADE,
  CONSTRAINT fk_vim_product  FOREIGN KEY (product_id)
    REFERENCES products(id)  ON DELETE CASCADE,
  UNIQUE KEY uq_variant (product_id, shopify_variant_id),
  INDEX idx_vim_merchant (merchant_id)
) ENGINE=InnoDB CHARACTER SET utf8mb4;
```

> **Note:** `merchant_id` was added in migration `009` (backfilled from `products`). It allows
> per-shop queries without a JOIN through `products`.

---

## 8. tryon_sessions

```sql
CREATE TABLE tryon_sessions (
  id                   CHAR(36)        PRIMARY KEY,
  merchant_id          INT UNSIGNED    NOT NULL,
  product_id           INT UNSIGNED    NOT NULL,
  variant_id           INT UNSIGNED    DEFAULT NULL,
  status               ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
  result_image_url     TEXT            DEFAULT NULL,
  result_seed          INT             DEFAULT NULL,
  result_expires_at    DATETIME        DEFAULT NULL,
  error_message        VARCHAR(500)    DEFAULT NULL,
  api_request_at       DATETIME        DEFAULT NULL,
  api_response_at      DATETIME        DEFAULT NULL,
  api_latency_ms       INT UNSIGNED    DEFAULT NULL,
  action_add_to_cart   TINYINT(1)      NOT NULL DEFAULT 0,
  action_buy_now       TINYINT(1)      NOT NULL DEFAULT 0,
  action_save_image    TINYINT(1)      NOT NULL DEFAULT 0,
  action_share_wa      TINYINT(1)      NOT NULL DEFAULT 0,
  device_type          ENUM('mobile','tablet','desktop') DEFAULT NULL,
  country_code         CHAR(2)         DEFAULT NULL,
  created_at           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ts_merchant FOREIGN KEY (merchant_id)
    REFERENCES merchants(id) ON DELETE CASCADE,
  CONSTRAINT fk_ts_product  FOREIGN KEY (product_id)
    REFERENCES products(id)  ON DELETE CASCADE,
  INDEX idx_merchant_date (merchant_id, created_at),
  INDEX idx_status (status)
) ENGINE=InnoDB CHARACTER SET utf8mb4;
```

---

## 9. tryon_conversions

```sql
CREATE TABLE tryon_conversions (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tryon_session_id    CHAR(36)        NOT NULL,
  merchant_id         INT UNSIGNED    NOT NULL,
  shopify_order_id    BIGINT UNSIGNED NOT NULL,
  shopify_order_gid   VARCHAR(100)    DEFAULT NULL,
  order_value_inr     DECIMAL(10,2)   DEFAULT NULL,
  attributed_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tc_session  FOREIGN KEY (tryon_session_id)
    REFERENCES tryon_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_tc_merchant FOREIGN KEY (merchant_id)
    REFERENCES merchants(id)      ON DELETE CASCADE,
  UNIQUE KEY uq_order_session (shopify_order_id, tryon_session_id)
) ENGINE=InnoDB CHARACTER SET utf8mb4;
```

---

## 10. analytics_daily

```sql
CREATE TABLE analytics_daily (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  merchant_id         INT UNSIGNED    NOT NULL,
  date                DATE            NOT NULL,
  tryon_initiated     INT UNSIGNED    NOT NULL DEFAULT 0,
  tryon_completed     INT UNSIGNED    NOT NULL DEFAULT 0,
  tryon_failed        INT UNSIGNED    NOT NULL DEFAULT 0,
  add_to_cart_count   INT UNSIGNED    NOT NULL DEFAULT 0,
  buy_now_count       INT UNSIGNED    NOT NULL DEFAULT 0,
  save_count          INT UNSIGNED    NOT NULL DEFAULT 0,
  share_wa_count      INT UNSIGNED    NOT NULL DEFAULT 0,
  order_count         INT UNSIGNED    NOT NULL DEFAULT 0,
  revenue_inr         DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  avg_latency_ms      INT UNSIGNED    DEFAULT NULL,
  computed_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                      ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ad_merchant FOREIGN KEY (merchant_id)
    REFERENCES merchants(id) ON DELETE CASCADE,
  UNIQUE KEY uq_merchant_date (merchant_id, date),
  INDEX idx_date (date)
) ENGINE=InnoDB CHARACTER SET utf8mb4;
```

---

## Migration history

| File | Description |
|------|-------------|
| `001_merchants.sql` | Create `merchants` and `merchant_settings` (initial schema) |
| `002_products.sql` | Create `products` and `variant_image_mappings` |
| `003_sessions.sql` | Create `tryon_sessions` and `tryon_conversions` |
| `004_analytics.sql` | Create `analytics_daily` |
| `005_plan_limits.sql` | Create `plan_limits`, seed free/starter/growth/scale rows |
| `006_rebrand_plans.sql` | Rename plans to basic/pro/premium, update `plan_limits` |
| `007_shop_meta.sql` | Add `shopify_plan`, `installed_theme_*` to `merchants`; create `collections` and `product_collection_map` |
| `008_merchant_settings_v2.sql` | Change `widget_language` to `VARCHAR(10)`; add 28 widget-config columns to `merchant_settings` |
| `009_variant_mappings_merchant_id.sql` | Add `merchant_id` to `variant_image_mappings` (backfilled from `products`) |
