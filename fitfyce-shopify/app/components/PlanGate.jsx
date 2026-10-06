import PropTypes from "prop-types";
import { Link } from "react-router";
import { planAtLeast, PLAN_LABELS, PLAN_PRICES } from "../lib/plans";
import { FsButton, FsIcon } from "./fs-ui";

function UpgradeCard({ label, price, featureName }) {
  return (
    <div className="fs-card fs-gate-card">
      <span className="fs-gate-icon"><FsIcon name="lock" size={18} /></span>
      <div>
        <p className="fs-gate-title">{featureName ?? "This feature"} is part of the {label} plan</p>
        <p className="fs-gate-sub">Upgrade to {label} ({price}) to unlock it, plus more try-ons every month.</p>
      </div>
      <FsButton to="/app/plans">See plans</FsButton>
    </div>
  );
}

UpgradeCard.propTypes = { label: PropTypes.string, price: PropTypes.string, featureName: PropTypes.string };

/**
 * Renders children when the plan qualifies, otherwise shows a locked prompt.
 * mode="replace" — swaps content entirely for a full upgrade card (for full-page or tab gates).
 * mode="overlay" — shows the real field disabled, with a small lock badge (for inline section gates).
 */
export default function PlanGate({
  currentPlan,
  requiredPlan,
  featureName,
  children,
  mode = "replace",
}) {
  if (planAtLeast(currentPlan, requiredPlan)) {
    return children;
  }

  const label = PLAN_LABELS[requiredPlan] ?? requiredPlan;
  const price = PLAN_PRICES[requiredPlan] ?? "";

  if (mode === "overlay") {
    return (
      <div className="fs-gate-wrap">
        <div aria-hidden="true" className="fs-gate-dim">{children}</div>
        <Link
          to="/app/plans"
          className="fs-gate-lock"
          title={`${featureName ?? "This feature"} requires the ${label} plan`}
          aria-label={`${featureName ?? "This feature"} is locked — part of the ${label} plan. See plans.`}
        >
          <FsIcon name="lock" size={13} />
        </Link>
      </div>
    );
  }

  return (
    <div style={{ padding: "64px 16px" }}>
      <UpgradeCard label={label} price={price} featureName={featureName} />
    </div>
  );
}

PlanGate.propTypes = {
  currentPlan: PropTypes.string,
  requiredPlan: PropTypes.string.isRequired,
  featureName: PropTypes.string,
  children: PropTypes.node,
  mode: PropTypes.oneOf(["replace", "overlay"]),
};
