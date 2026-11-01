-- OAuth session storage for the PHP admin UI (replaces Prisma Session table
-- that lived in the Remix fitfyce-shopify app). One row per logged-in
-- browser; cookie carries only the opaque session id.
--
-- The session links to a merchant row, so admin pages know which shop they
-- are rendering for without re-doing OAuth on every request.

CREATE TABLE admin_sessions (
  id              CHAR(64) PRIMARY KEY,
  merchant_id     INT UNSIGNED NOT NULL,
  shop_domain     VARCHAR(255) NOT NULL,
  access_token    TEXT NOT NULL,
  scope           TEXT NULL,
  expires_at      DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_admin_sess_merchant FOREIGN KEY (merchant_id)
    REFERENCES merchants(id) ON DELETE CASCADE,
  INDEX idx_admin_sess_shop (shop_domain),
  INDEX idx_admin_sess_last (last_seen_at)
) ENGINE=InnoDB CHARACTER SET utf8mb4;

-- Short-lived OAuth state tokens (CSRF guard between /auth/install and
-- /auth/callback). Rows self-expire after 10 minutes; a cron can delete
-- stale rows but it is not required for correctness.
CREATE TABLE admin_oauth_states (
  state       CHAR(64) PRIMARY KEY,
  shop_domain VARCHAR(255) NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_oauth_state_created (created_at)
) ENGINE=InnoDB CHARACTER SET utf8mb4;
