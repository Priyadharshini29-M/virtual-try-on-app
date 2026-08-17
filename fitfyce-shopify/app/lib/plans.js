export const PLAN_ORDER = ['free', 'growth', 'pro'];

export const PLAN_LABELS = {
  free:   'Preview',
  growth: 'Growth',
  pro:    'Pro',
};

export const PLAN_PRICES = {
  free:   'Free',
  growth: '$19/month',
  pro:    '$49/month',
};

export const PLAN_TRYONS = {
  free:   10,
  growth: 100,
  pro:    500,
};

/** Returns true if currentPlan meets or exceeds requiredPlan. */
export function planAtLeast(currentPlan, requiredPlan) {
  const ci = PLAN_ORDER.indexOf(currentPlan ?? 'free');
  const ri = PLAN_ORDER.indexOf(requiredPlan);
  if (ri === -1 || ci === -1) return false;
  return ci >= ri;
}

// PHP backend stores plans as: basic / pro / premium
// UI uses:                      free  / growth / pro
const PHP_TO_UI = { basic: 'free', pro: 'growth', premium: 'pro' };
const UI_TO_PHP = { free: 'basic', growth: 'pro', pro: 'premium' };

/** Convert PHP plan name → UI plan key (e.g. "pro" → "growth"). */
export function phpPlanToUi(phpPlan) {
  return PHP_TO_UI[phpPlan] ?? 'free';
}

/** Convert UI plan key → PHP plan name (e.g. "growth" → "pro"). */
export function uiPlanToPhp(uiPlan) {
  return UI_TO_PHP[uiPlan] ?? 'basic';
}
