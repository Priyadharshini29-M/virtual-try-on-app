-- Hard cutover from fixed plans (basic/pro/premium with monthly try-on
-- limits) to a wallet-based credit model (Interakt-style pay-as-you-go).
-- 1 credit = 1 try-on or AI generation. Credits never expire.
--
-- Rolling back: drop credit_transactions, credit_payments, and the
-- wallet_credits column, then rerun 006_rebrand_plans.sql.

-- 1. Wallet balance lives on the merchant row for a single-query debit path.
ALTER TABLE merchants
  ADD COLUMN wallet_credits INT NOT NULL DEFAULT 0 AFTER plan,
  ADD COLUMN wallet_total_debited INT UNSIGNED NOT NULL DEFAULT 0 AFTER wallet_credits;

-- 2. Append-only ledger. Every debit (try-on, generation) and credit
--    (purchase, bonus, refund) writes one row here so admins can audit
--    the balance deterministically from history.
CREATE TABLE credit_transactions (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  merchant_id     INT UNSIGNED NOT NULL,
  -- + for a credit (purchase/bonus/refund), - for a debit (try-on/generation).
  delta           INT NOT NULL,
  reason          ENUM('tryon','studio','infographic','purchase','welcome_bonus','refund','admin_grant','admin_debit','release') NOT NULL,
  reference_type  VARCHAR(32) NULL,
  reference_id    VARCHAR(100) NULL,
  balance_after   INT NOT NULL,
  note            VARCHAR(255) NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_credit_tx_merchant FOREIGN KEY (merchant_id)
    REFERENCES merchants(id) ON DELETE CASCADE,
  INDEX idx_credit_tx_merchant (merchant_id, id),
  INDEX idx_credit_tx_reason   (reason)
) ENGINE=InnoDB CHARACTER SET utf8mb4;

-- 3. External payment orders (Razorpay today, Stripe later). The webhook
--    moves an order from created -> captured and only then applies the
--    credit to the wallet.
CREATE TABLE credit_payments (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  merchant_id       INT UNSIGNED NOT NULL,
  provider          ENUM('razorpay','stripe','manual') NOT NULL DEFAULT 'razorpay',
  provider_order_id VARCHAR(100) NOT NULL,
  provider_payment_id VARCHAR(100) NULL,
  amount_minor      INT UNSIGNED NOT NULL,
  currency          CHAR(3) NOT NULL DEFAULT 'INR',
  credits           INT UNSIGNED NOT NULL,
  status            ENUM('created','captured','failed','refunded') NOT NULL DEFAULT 'created',
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  captured_at       DATETIME NULL,
  CONSTRAINT fk_credit_pay_merchant FOREIGN KEY (merchant_id)
    REFERENCES merchants(id) ON DELETE CASCADE,
  UNIQUE KEY uq_provider_order (provider, provider_order_id),
  INDEX idx_credit_pay_merchant (merchant_id, created_at)
) ENGINE=InnoDB CHARACTER SET utf8mb4;

-- 4. Grandfather existing merchants with a 25-credit welcome bonus and a
--    matching ledger row (so balance = SUM(delta) by invariant). Does
--    nothing on reruns because of the ledger row check.
INSERT INTO credit_transactions (merchant_id, delta, reason, balance_after, note)
  SELECT m.id, 25, 'welcome_bonus', 25, 'Wallet migration welcome bonus'
    FROM merchants m
   WHERE NOT EXISTS (
     SELECT 1 FROM credit_transactions t
      WHERE t.merchant_id = m.id AND t.reason = 'welcome_bonus'
   );

UPDATE merchants m
   SET wallet_credits = GREATEST(
       (SELECT COALESCE(SUM(delta), 0) FROM credit_transactions t WHERE t.merchant_id = m.id),
       0
     );

-- 5. Drop the plan columns that no longer gate anything. Keep the `plan`
--    column so legacy rows still parse (controllers no longer read it),
--    and drop plan_limits entirely.
DROP TABLE IF EXISTS plan_limits;
