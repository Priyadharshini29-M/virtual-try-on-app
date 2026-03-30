
CREATE TABLE plan_limits (
  plan                  ENUM('free','starter','growth','scale') PRIMARY KEY,
  monthly_tryon_limit   INT UNSIGNED NOT NULL,
  max_products          INT UNSIGNED NOT NULL,
  analytics_enabled     TINYINT(1) NOT NULL DEFAULT 0,
  custom_api_enabled    TINYINT(1) NOT NULL DEFAULT 0,
  branding_removable    TINYINT(1) NOT NULL DEFAULT 0,
  share_enabled         TINYINT(1) NOT NULL DEFAULT 1,
  price_inr_monthly     INT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB CHARACTER SET utf8mb4;

INSERT INTO plan_limits VALUES
  ('free',      50,    1,    0, 0, 0, 1,    0),
  ('starter',   500,   0,    0, 0, 1, 1,  999),
  ('growth',    3000,  0,    1, 0, 1, 1, 2499),
  ('scale',     0,     0,    1, 1, 1, 1, 5999);
