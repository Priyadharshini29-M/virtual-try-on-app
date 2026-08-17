/**
 * app.studio.jsx — AI Studio layout wrapper.
 * Parent auth is already handled by app.jsx. This just renders child routes.
 *
 * Children:
 *   app.studio._index.jsx  → /app/studio       (dashboard + models library)
 *   app.studio.create.jsx  → /app/studio/create (workflow wizards)
 */

import { Outlet } from "react-router";

export default function StudioLayout() {
  return <Outlet />;
}
