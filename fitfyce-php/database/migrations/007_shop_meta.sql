-- Add Shopify plan and installed theme metadata to merchants
ALTER TABLE merchants
    ADD COLUMN shopify_plan         VARCHAR(100) NULL AFTER plan,
    ADD COLUMN installed_theme_name VARCHAR(255) NULL AFTER shopify_plan,
    ADD COLUMN installed_theme_id   BIGINT UNSIGNED NULL AFTER installed_theme_name;

-- Shopify collections (synced from Shopify API)
CREATE TABLE IF NOT EXISTS collections (
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
    UNIQUE KEY uq_merchant_collection (merchant_id, shopify_collection_id),
    CONSTRAINT fk_collections_merchant FOREIGN KEY (merchant_id)
        REFERENCES merchants(id) ON DELETE CASCADE
) ENGINE=InnoDB CHARACTER SET utf8mb4;

-- Product ↔ collection membership (many-to-many)
CREATE TABLE IF NOT EXISTS product_collection_map (
    product_id    INT UNSIGNED NOT NULL,
    collection_id INT UNSIGNED NOT NULL,
    PRIMARY KEY (product_id, collection_id),
    CONSTRAINT fk_pcm_product    FOREIGN KEY (product_id)    REFERENCES products(id)    ON DELETE CASCADE,
    CONSTRAINT fk_pcm_collection FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
) ENGINE=InnoDB CHARACTER SET utf8mb4;
