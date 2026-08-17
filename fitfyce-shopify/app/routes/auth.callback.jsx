import { authenticate } from "../shopify.server";
import { PHP_API_URL, PHP_API_SECRET } from "../lib/env.server";

/**
 * After Shopify OAuth completes, register (or reactivate) the merchant
 * in the PHP backend so they get a unique api_key.
 */
export async function loader({ request }) {
  const { session, redirect } = await authenticate.admin(request);

  const base = (PHP_API_URL).replace(/\/$/, "");

  if (base) {
    try {
      await fetch(`${base}/merchant/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": PHP_API_SECRET,
        },
        body: JSON.stringify({
          shopify_domain:   session.shop,
          shopify_store_id: session.shop,
          access_token:     session.accessToken,
        }),
      });
    } catch (err) {
      // Log but don't block the install
      console.error("PHP merchant register failed:", err);
    }
  }

  // Include shop so App Bridge has context when re-embedding after OAuth
  return redirect(`/app?shop=${session.shop}`);
}
