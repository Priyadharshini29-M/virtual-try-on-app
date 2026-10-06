/**
 * PHP API client — server-side only.
 * baseUrl and apiKey are never exposed to the client bundle.
 * Named .server.js so React Router excludes it from the browser bundle.
 *
 * Every request carries both:
 *   X-Api-Key: <per-shop merchant key>   — for PHP to resolve the merchant
 *   X-Shop-Domain: <shop domain>         — explicit fallback so PHP can always
 *                                          scope data to the correct shop even
 *                                          if the api_key lookup fails
 */
import https from "node:https";
import http from "node:http";

const phpHttpsAgent = new https.Agent({ rejectUnauthorized: false });

export default function phpApiClient(apiKey, baseUrl, shopDomain = null) {
  const base = baseUrl.replace(/\/$/, '');

  function request(method, path, body = null, timeoutMs = 10_000) {
    if (!base) {
      return Promise.resolve({ ok: false, error: 'PHP_API_URL is not configured on this server.', status: 0 });
    }

    // Append shop as query param on GET requests for extra scoping
    let urlStr = `${base}${path}`;
    if (shopDomain && method === 'GET' && !path.includes('shop=')) {
      const sep = path.includes('?') ? '&' : '?';
      urlStr = `${urlStr}${sep}shop=${encodeURIComponent(shopDomain)}`;
    }
    // POST/PUT/PATCH: also append shop so PHP can always scope
    if (shopDomain && method !== 'GET' && !urlStr.includes('shop=')) {
      const sep = urlStr.includes('?') ? '&' : '?';
      urlStr = `${urlStr}${sep}shop=${encodeURIComponent(shopDomain)}`;
    }

    const headers = {
      'X-Api-Key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    };
    if (shopDomain) headers['X-Shop-Domain'] = shopDomain;

    const bodyStr = body !== null ? JSON.stringify(body) : null;
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr).toString();

    const parsed = new URL(urlStr);
    const isHttps = parsed.protocol === "https:";
    const client = isHttps ? https : http;
    const defaultPort = isHttps ? 443 : 80;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        req.destroy();
        resolve({ ok: false, error: 'Request timed out', status: 0 });
      }, timeoutMs);

      const req = client.request(
        { 
          hostname: parsed.hostname, 
          port: parsed.port || defaultPort, 
          path: parsed.pathname + parsed.search, 
          method, 
          headers, 
          agent: isHttps ? phpHttpsAgent : undefined 
        },
        (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (c) => { raw += c; });
          res.on('end', () => {
            clearTimeout(timer);
            let data = {};
            try { data = JSON.parse(raw); } catch { data = {}; }
            if (!res.ok && (res.statusCode < 200 || res.statusCode >= 300)) {
              const errMsg = data.error ?? data.message ?? data.msg ?? data.detail ?? (Array.isArray(data.errors) ? data.errors[0] : null) ?? `Request failed (HTTP ${res.statusCode})`;
              resolve({ ok: false, error: errMsg, status: res.statusCode, data });
            } else {
              resolve({ ok: true, data });
            }
          });
        }
      );
      req.on('error', (err) => {
        clearTimeout(timer);
        resolve({ ok: false, error: err?.message ?? 'Network error', status: 0 });
      });
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  return {
    getSettings: () =>
      request('GET', '/settings'),

    saveSettings: (data) =>
      request('POST', '/settings', data),

    getProducts: () =>
      request('GET', '/products'),

    syncProduct: (data, timeoutMs) =>
      request('POST', '/products/sync', data, timeoutMs),

    getVariantMappings: (productId) =>
      request('GET', `/variants/mapping?product_id=${productId}`),

    saveVariantMapping: (data) =>
      request('POST', '/variants/mapping', data),

    updateVariantMapping: (id, data) =>
      request('PUT', `/variants/mapping/${id}`, data),

    createSession: (data) =>
      request('POST', '/session/create', data, 35_000),

    trackAction: (sessionId, action) =>
      request('POST', '/session/track', { session_id: sessionId, action }),

    getAnalytics: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return request('GET', `/analytics${qs ? '?' + qs : ''}`);
    },

    getLeads: (limit = 100) =>
      request('GET', `/leads?limit=${limit}`),

    getPlans: () =>
      request('GET', '/plans'),

    checkPlanLimit: () =>
      request('GET', '/plan/limit'),

    updatePlan: (plan) =>
      request('POST', '/plan/update', { plan }),

    recordConversion: (data) =>
      request('POST', '/conversion', data),

    getShopInfo: () =>
      request('GET', '/shop'),

    getShopProducts: () =>
      request('GET', '/shop/products'),

    getWidgetSettings: () =>
      request('GET', '/widget/settings'),

    patchWidgetSettings: (data) =>
      request('PATCH', '/widget/settings', data),

    // ── Built-in AI Studio model library ─────────────────────────────────────
    getDefaultModels: () =>
      request('GET', '/studio/default-models'),

    setDefaultModelActive: (modelKey, active) =>
      request('POST', '/studio/default-models/activate', { model_key: modelKey, active: !!active }),

    // ── Merchant onboarding (answers collected by the first-run wizard) ─────
    getOnboarding: () =>
      request('GET', '/merchant/onboarding'),

    saveOnboarding: (data) =>
      request('POST', '/merchant/onboarding', data),

    // ── Garment Studio ───────────────────────────────────────────────────────

    studioGenerate: (data) =>
      request('POST', '/studio/generate', data, 30_000),

    studioGenerateStatus: (sessionId) =>
      request('GET', `/studio/generate-status?session_id=${encodeURIComponent(sessionId)}`),

    studioSetupCheck: () =>
      request('GET', '/studio/setup-check'),

    studioGetModels: () =>
      request('GET', '/studio/models'),

    studioGetSession: (sessionId) =>
      request('GET', `/studio/session?session_id=${encodeURIComponent(sessionId)}`),

    studioListSessions: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return request('GET', `/studio/sessions${qs ? '?' + qs : ''}`);
    },

    studioSaveGallery: (sessionId) =>
      request('POST', '/studio/save-gallery', { session_id: sessionId }),

    studioSetModelImage: (modelKey, imageUrl) =>
      request('POST', '/studio/set-model-image', { model_key: modelKey, image_url: imageUrl }),

    studioDeleteModelImage: (modelKey) =>
      request('DELETE', '/studio/model-image', { model_key: modelKey }),

    // ── RAG knowledge index (grounds infographic generation) ─────────────────

    ragReindex: () =>
      request('POST', '/rag/reindex', {}, 60_000),

    ragStatus: () =>
      request('GET', '/rag/status'),

    // ── Infographic (OpenAI vision classification + OpenAI image generation) ──
    // Synchronous — create()/generate()/edit() run the full pipeline
    // (classification, extraction, scene/layout planning, compose, QC)
    // inline and respond with the finished result in one request. A single
    // gpt-image-1 compose call alone can measure 100-115s, and the bounded
    // QC auto-retry can add a second one — give this real headroom, matching
    // InfographicController.php's own @set_time_limit(200).

    infographicCreate: (data) =>
      request('POST', '/infographic/create', data, 210_000),

    infographicExtractPoints: (data) =>
      request('POST', '/infographic/extract-points', data, 30_000),

    infographicGenerate: (data) =>
      request('POST', '/infographic/generate', data, 210_000),

    infographicEdit: (data) =>
      request('POST', '/infographic/edit', data, 170_000),

    // ── Studio v2 (single-flow: saved models, FASHN generation, auto OpenAI marketing infographics) ──

    studioV2UploadModel: (imageUrl) =>
      request('POST', '/studio-v2/models', { image_url: imageUrl }),

    studioV2ListModels: () =>
      request('GET', '/studio-v2/models'),

    studioV2DeleteModel: (savedModelId) =>
      request('DELETE', '/studio-v2/models', { saved_model_id: savedModelId }),

    studioV2Generate: (data) =>
      request('POST', '/studio-v2/generate', data, 30_000),

    // Longer timeout — the completing poll response also runs the synchronous
    // 5-image OpenAI marketing-infographic batch before responding.
    studioV2GenerateStatus: (generationId) =>
      request('GET', `/studio-v2/generate-status?generation_id=${encodeURIComponent(generationId)}`, null, 120_000),

    studioV2RegenerateInfographics: (generationId) =>
      request('POST', '/studio-v2/regenerate-infographics', { generation_id: generationId }, 90_000),

    studioV2DeleteGeneration: (generationId) =>
      request('DELETE', '/studio-v2/generation', { generation_id: generationId }),

    studioV2ListGenerations: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return request('GET', `/studio-v2/generations${qs ? '?' + qs : ''}`);
    },

    studioV2GetGeneration: (generationId) =>
      request('GET', `/studio-v2/generation?generation_id=${encodeURIComponent(generationId)}`),

    studioV2ListAssets: () =>
      request('GET', '/studio-v2/assets'),

    // ── Size Chart module ─────────────────────────────────────────────────────
    getSizeCharts: () =>
      request('GET', '/size-chart'),

    createSizeChart: (data) =>
      request('POST', '/size-chart', data),

    updateSizeChart: (data) =>
      request('PATCH', '/size-chart', data),

    deleteSizeChart: (id) =>
      request('DELETE', '/size-chart', { id }),

    assignSizeChart: (shopifyProductId, chartId) =>
      request('POST', '/size-chart/assign', { shopify_product_id: shopifyProductId, chart_id: chartId }),

    unassignSizeChart: (shopifyProductId) =>
      request('DELETE', '/size-chart/assign', { shopify_product_id: shopifyProductId }),

    setSizeChartEnabled: (enabled) =>
      request('POST', '/size-chart/enabled', { enabled }),

    // ── Complete Your Look module ────────────────────────────────────────────
    getCompleteLook: () =>
      request('GET', '/complete-look'),

    setCompleteLookPairings: (shopifyProductId, pairedIds) =>
      request('POST', '/complete-look/pairings', { shopify_product_id: shopifyProductId, paired_ids: pairedIds }),

    setCompleteLookEnabled: (enabled) =>
      request('POST', '/complete-look/enabled', { enabled }),
  };
}
