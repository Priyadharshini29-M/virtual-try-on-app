/**
 * app.onboarding-status.jsx — diagnostics for the onboarding wizard's saved data.
 * Route: /app/onboarding-status (not in the nav — open it directly).
 *
 * Shows, side by side: the Shopify metafield copy, the PHP database row
 * (GET /merchant/onboarding), and whether the PHP backend is reachable.
 */
import PropTypes from "prop-types";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { authenticate } from "../shopify.server";
import phpApiClient from "../lib/php-api.server";
import { ensureMerchant } from "../lib/merchant.server";
import { PHP_API_URL } from "../lib/env.server";
import { FsPage, FsCard, FsButton, FsPill, FsIcon } from "../components/fs-ui";

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);

  let metafield = null;
  let metafieldError = null;
  try {
    const res = await admin.graphql(`#graphql
      query { shop { metafield(namespace: "fitfyce", key: "onboarding") { value updatedAt } } }
    `);
    const mf = (await res.json())?.data?.shop?.metafield;
    metafield = mf ? { updatedAt: mf.updatedAt, value: JSON.parse(mf.value) } : null;
  } catch (err) {
    metafieldError = err?.message ?? String(err);
  }

  const apiKey = await ensureMerchant(session);
  const api = phpApiClient(apiKey, PHP_API_URL, session.shop);
  const [health, row] = await Promise.all([api.checkPlanLimit(), api.getOnboarding()]);

  return {
    shop: session.shop,
    backendUrl: PHP_API_URL,
    metafield,
    metafieldError,
    backendReachable: { ok: !!health.ok, status: health.status ?? null, error: health.ok ? null : health.error },
    backendRow: { ok: !!row.ok, status: row.status ?? null, error: row.ok ? null : row.error, data: row.ok ? row.data?.onboarding ?? null : null },
  };
}

// "Restart setup": clears the metafield so the dashboard opens the wizard again
// at step 1. The database row is left as-is and is overwritten by the next save.
export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const shopRes = await admin.graphql(`#graphql
    query { shop { id } }
  `);
  const shopId = (await shopRes.json())?.data?.shop?.id;
  const res = await admin.graphql(
    `#graphql
    mutation ResetOnboarding($metafields: [MetafieldIdentifierInput!]!) {
      metafieldsDelete(metafields: $metafields) { userErrors { message } }
    }`,
    { variables: { metafields: [{ ownerId: shopId, namespace: "fitfyce", key: "onboarding" }] } },
  );
  const errors = (await res.json())?.data?.metafieldsDelete?.userErrors ?? [];
  return { reset: errors.length === 0, error: errors[0]?.message ?? null };
}

function Status({ ok, label }) {
  return ok
    ? <FsPill tone="success"><FsIcon name="check" size={12} strokeWidth={3} />{label}</FsPill>
    : <FsPill tone="warning"><FsIcon name="info" size={12} />{label}</FsPill>;
}

Status.propTypes = { ok: PropTypes.bool, label: PropTypes.string };

function Json({ value }) {
  return <pre className="fs-error-pre" style={{ maxHeight: 420, overflow: "auto" }}>{JSON.stringify(value, null, 2)}</pre>;
}

Json.propTypes = { value: PropTypes.any };

export default function OnboardingStatus() {
  const d = useLoaderData();
  const revalidator = useRevalidator();
  const resetFetcher = useFetcher();
  const mf = d.metafield?.value;
  const wizardState = !mf ? "Will open on the dashboard (step 1)"
    : mf.completed ? "Finished — won't open again"
      : mf.skipped ? "Skipped — shows a Resume banner"
        : `In progress — resumes at step ${Number(mf.step ?? 0) + 1}`;

  return (
    <FsPage
      title="Onboarding data check"
      subtitle={`Where the setup wizard's answers are stored for ${d.shop}.`}
      actions={
        <>
          <FsButton variant="ghost" icon="refresh" onClick={() => revalidator.revalidate()}>{revalidator.state === "loading" ? "Refreshing…" : "Refresh"}</FsButton>
          <FsButton onClick={() => resetFetcher.submit({}, { method: "POST" })} disabled={resetFetcher.state !== "idle"}>
            {resetFetcher.state !== "idle" ? "Restarting…" : "Restart setup"}
          </FsButton>
        </>
      }
    >
      <div className="fs-banner fs-banner--info">
        <FsIcon name="info" size={16} />
        <span><strong>Wizard:</strong> {wizardState}.{resetFetcher.data?.reset ? " Setup restarted — open the Dashboard to see it." : ""}{resetFetcher.data?.error ? ` Reset failed: ${resetFetcher.data.error}` : ""}</span>
      </div>
      <div className="fs-grid-12">
        <FsCard className="fs-span-4" title="1. Backend reachable" action={<Status ok={d.backendReachable.ok} label={d.backendReachable.ok ? "Online" : "Failing"} />}>
          <p className="fs-help" style={{ margin: 0 }}>{d.backendUrl}</p>
          {!d.backendReachable.ok && (
            <p style={{ margin: 0, fontSize: 13 }}>HTTP {d.backendReachable.status || "—"} · {d.backendReachable.error || "no response"}. Every backend save fails until this is fixed — check the PHP error log on the server.</p>
          )}
        </FsCard>
        <FsCard className="fs-span-4" title="2. Database row" action={<Status ok={!!d.backendRow.data} label={d.backendRow.data ? "Saved" : "Not found"} />}>
          {d.backendRow.data ? (
            <p style={{ margin: 0, fontSize: 13 }}>Step {Number(d.backendRow.data.current_step) + 1} · updated {d.backendRow.data.updated_at}</p>
          ) : (
            <p style={{ margin: 0, fontSize: 13 }}>
              {d.backendRow.ok ? "No answers saved in merchant_onboarding yet." : `HTTP ${d.backendRow.status || "—"} · ${d.backendRow.error || "no response"}. The /merchant/onboarding route or its table isn't live on the backend yet.`}
            </p>
          )}
        </FsCard>
        <FsCard className="fs-span-4" title="3. Shopify metafield" action={<Status ok={!!d.metafield} label={d.metafield ? "Saved" : "Empty"} />}>
          <p style={{ margin: 0, fontSize: 13 }}>
            {d.metafield ? `Step ${Number(d.metafield.value?.step ?? 0) + 1} · updated ${new Date(d.metafield.updatedAt).toLocaleString()}` : d.metafieldError || "Nothing saved yet — complete a wizard step first."}
          </p>
        </FsCard>
      </div>

      <div className="fs-grid-12">
        <FsCard className="fs-span-6" title="Database row (merchant_onboarding)"><Json value={d.backendRow.data ?? { status: d.backendRow.status, error: d.backendRow.error }} /></FsCard>
        <FsCard className="fs-span-6" title="Metafield (fitfyce.onboarding)"><Json value={d.metafield?.value ?? null} /></FsCard>
      </div>
    </FsPage>
  );
}
