
CREATE TABLE products (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  merchant_id          INT UNSIGNED NOT NULL,
  shopify_product_id   BIGINT UNSIGNED NOT NULL,
  shopify_product_gid  VARCHAR(100) NOT NULL,
  title                VARCHAR(500) NOT NULL,
  handle               VARCHAR(500) NOT NULL,
  is_tryon_enabled     TINYINT(1) NOT NULL DEFAULT 1,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_p_merchant FOREIGN KEY (merchant_id)
    REFERENCES merchants(id) ON DELETE CASCADE,
  UNIQUE KEY uq_merchant_product (merchant_id, shopify_product_id),
  INDEX idx_enabled (merchant_id, is_tryon_enabled)
) ENGINE=InnoDB CHARACTER SET utf8mb4;

CREATE TABLE variant_image_mappings (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id            INT UNSIGNED NOT NULL,
  shopify_variant_id    BIGINT UNSIGNED NOT NULL,
  shopify_variant_gid   VARCHAR(100) NOT NULL,
  variant_title         VARCHAR(255),
  tryon_image_url       TEXT NOT NULL,
  image_type            ENUM('flat_lay','ghost_mannequin','on_model') NOT NULL DEFAULT 'flat_lay',
  avatar_sex            ENUM('male','female') DEFAULT NULL,
  clothing_prompt       VARCHAR(500) DEFAULT NULL,
  is_approved           TINYINT(1) NOT NULL DEFAULT 1,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_vim_product FOREIGN KEY (product_id)
    REFERENCES products(id) ON DELETE CASCADE,
  UNIQUE KEY uq_variant (product_id, shopify_variant_id)
) ENGINE=InnoDB CHARACTER SET utf8mb4;
