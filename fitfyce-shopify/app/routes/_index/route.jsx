import { redirect, Form, useLoaderData } from "react-router";
import { login, authenticate } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  // Any Shopify-context params mean we're in the embedded app — go to dashboard
  if (
    url.searchParams.get("shop") ||
    url.searchParams.get("hmac") ||
    url.searchParams.get("session") ||
    url.searchParams.get("id_token")
  ) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  // Shopify Admin's own "back to app home" navigation reaches "/" via a
  // client-side route change that carries none of the params above, even
  // though the embedded session is still live. Fall back to checking for
  // that session before treating this as a genuine public/logged-out visit.
  try {
    await authenticate.admin(request);
    throw redirect("/app");
  } catch (err) {
    if (err instanceof Response) throw err;
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>FitSnap — AI Virtual Try-On</h1>
        <p className={styles.text}>
          Let shoppers see how clothes look on them before they buy. Reduce
          returns, increase conversions, and build buyer confidence with
          AI-powered virtual fitting — directly on your Shopify product pages.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>AI-powered try-on.</strong> Shoppers upload a photo and
            instantly see the product on their body — no guesswork needed.
          </li>
          <li>
            <strong>Zero-code setup.</strong> Add the FitSnap block to any
            product page via the Shopify Theme Editor in under 2 minutes.
          </li>
          <li>
            <strong>Built-in analytics.</strong> Track try-on sessions,
            add-to-cart rate, conversions, and device breakdown from your
            FitSnap dashboard.
          </li>
        </ul>
      </div>
    </div>
  );
}
