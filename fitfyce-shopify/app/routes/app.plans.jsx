// The old /app/plans page is gone (wallet-based credits replaced fixed plans).
// This redirect keeps stale bookmarks working.
import { redirect } from "react-router";

export function loader() {
  return redirect("/app/wallet");
}

export default function PlansRedirect() {
  return null;
}
