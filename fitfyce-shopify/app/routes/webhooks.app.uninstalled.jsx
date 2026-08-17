import { authenticate } from "../shopify.server";
import db from "../db.server";
import { PHP_API_URL, PHP_API_SECRET } from "../lib/env.server";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Clean up sessions if present
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Call PHP API to deactivate merchant
  if (shop) {
    try {
      const res = await fetch(
        `${PHP_API_URL.replace(/\/$/, "")}/merchant/deactivate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Api-Key": PHP_API_SECRET,
          },
          body: JSON.stringify({ shopify_domain: shop }),
        },
      );
      if (!res.ok) {
        console.error(
          "Failed to deactivate merchant in PHP API",
          await res.text(),
        );
      }
    } catch (err) {
      console.error("Error calling PHP deactivate endpoint", err);
    }
  }

  return new Response();
};
