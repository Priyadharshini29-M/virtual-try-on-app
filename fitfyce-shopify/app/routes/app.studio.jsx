/**
 * app.studio.jsx — AI Studio layout wrapper.
 * Parent auth is already handled by app.jsx. This just renders child routes.
 *
 * Children:
 *   app.studio._index.jsx  → /app/studio       (dashboard + models library)
 *   app.studio.create.jsx  → /app/studio/create (workflow wizards)
 *
 * Beta gate: the whole module is hidden from merchants until FEATURE_AI_STUDIO
 * is set to "1" / "true" in the environment. Flipping the env var and
 * redeploying surfaces the nav link and makes these routes reachable again.
 */

import { Outlet, redirect } from "react-router";
import { FEATURE_AI_STUDIO } from "../lib/env.server";

export const loader = async () => {
  if (!FEATURE_AI_STUDIO) {
    throw redirect("/app");
  }
  return null;
};

export default function StudioLayout() {
  return <Outlet />;
}
