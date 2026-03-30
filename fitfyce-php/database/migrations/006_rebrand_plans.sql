-- Rename and update plan structure
-- Migration: 006_rebrand_plans.sql

-- 1. Update merchants table to accept new plan names
ALTER TABLE merchants MODIFY COLUMN plan ENUM('free', 'starter', 'growth', 'scale', 'basic', 'pro', 'premium') NOT NULL DEFAULT 'free';

-- 2. Map existing merchants to new plans
UPDATE merchants SET plan = 'basic' WHERE plan IN ('free', 'starter');
UPDATE merchants SET plan = 'pro' WHERE plan = 'growth';
UPDATE merchants SET plan = 'premium' WHERE plan = 'scale';

-- 3. Finalize enum in merchants (remove old values)
ALTER TABLE merchants MODIFY COLUMN plan ENUM('basic', 'pro', 'premium') NOT NULL DEFAULT 'basic';

-- 4. Update plan_limits table
DELETE FROM plan_limits;
ALTER TABLE plan_limits MODIFY COLUMN plan ENUM('basic', 'pro', 'premium') NOT NULL;

-- 5. Insert new 3-tier limits
-- (plan, monthly_tryon_limit, max_products, analytics_enabled, custom_api_enabled, branding_removable, share_enabled, price_inr_monthly)
INSERT INTO plan_limits VALUES
  ('basic',   100,    1,   0, 0, 0, 1, 0),
  ('pro',     2000,   0,   1, 0, 1, 1, 1499),
  ('premium', 10000,  0,   1, 1, 1, 1, 3999);
