import { useLoaderData, useSubmit, useNavigation, useActionData, useNavigate } from "react-router";
import { useState, useEffect } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  TextField,
  Select,
  Button,
  Badge,
  Banner,
  Divider,
  Thumbnail,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import phpApiClient from "../lib/php-api.server";
import { ensureMerchant } from "../lib/merchant.server";
import { PHP_API_URL } from "../lib/env.server";

const PRODUCT_QUERY = `#graphql
  query GetProduct($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      images(first: 20) {
        edges { node { id url altText } }
      }
      variants(first: 100) {
        edges {
          node { id title image { url } }
        }
      }
    }
  }
`;

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const apiKey  = await ensureMerchant(session);
  const url       = new URL(request.url);
  const productGid = url.searchParams.get("product_gid");
  const productId  = url.searchParams.get("product_id");

  if (!productGid || !productId) {
    return { product: null, variants: [], mappings: [], productImages: [], internalId: null, productId: null };
  }

  const gqlRes  = await admin.graphql(PRODUCT_QUERY, { variables: { id: productGid } });
  const gqlData = await gqlRes.json();
  const product = gqlData.data?.product ?? null;

  const variants      = (product?.variants?.edges ?? []).map((e) => e.node);
  const productImages = (product?.images?.edges   ?? []).map((e) => e.node);

  const api = phpApiClient(apiKey, PHP_API_URL, session.shop);

  const syncRes  = await api.syncProduct({
    shopify_product_id:  productId,
    shopify_product_gid: productGid,
    title:               product?.title  ?? "",
    handle:              product?.handle ?? "",
    is_tryon_enabled: 1,
  });

  const sd = syncRes.data ?? {};
  const internalId = syncRes.ok
    ? (sd.id ?? sd.product_id ?? sd.internal_id ?? sd.data?.id ?? null)
    : null;

  const syncError = !syncRes.ok ? (syncRes.error ?? null) : null;

  const mappingsRes = internalId
    ? await api.getVariantMappings(internalId)
    : { ok: true, data: [] };
  const mappings = mappingsRes.ok ? (mappingsRes.data ?? []) : [];

  // Prefer the product_id that PHP itself stored inside an existing mapping —
  // this guarantees we send the correct PHP internal FK even when syncProduct
  // returns a different id field (e.g. the Shopify product ID).
  const existingMapping = mappings[0] ?? null;
  const resolvedProductId = existingMapping?.product_id ?? internalId;

  return { product, variants, mappings, productImages, internalId: resolvedProductId, productId, syncError };
}

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);
  const body = await request.json();
  const api = phpApiClient(apiKey, PHP_API_URL, session.shop);

  const phpPayload = {
    product_id:          body.product_id         ?? null,
    shopify_product_id:  body.shopify_product_id ?? null,
    shopify_product_gid: body.product_gid        ?? null,
    shopify_variant_id:  body.shopify_variant_id,
    shopify_variant_gid: body.shopify_variant_gid,
    variant_title:       body.variant_title      ?? null,
    tryon_image_url:     body.tryon_image_url,
    image_type:          body.image_type         ?? "flat_lay",
    garment_type:        body.garment_type       ?? "top",
    avatar_sex:          body.avatar_sex         ?? null,
    clothing_prompt:     body.clothing_prompt    ?? null,
  };

  // Always POST — PHP does ON DUPLICATE KEY UPDATE (upsert) on shopify_variant_id
  const res = await api.saveVariantMapping(phpPayload);

  if (!res.ok) {
    return { ok: false, error: res.error ?? "Save failed. Please try again.", variant_id: body.shopify_variant_id };
  }

  // After saving, re-fetch all mappings for this product and write to
  // the Shopify metafield so the storefront widget can read them.
  const { product_id, product_gid } = body;
  if (product_id && product_gid) {
    const mappingsRes = await api.getVariantMappings(product_id);
    if (mappingsRes.ok && Array.isArray(mappingsRes.data)) {
      const metaValue = {};
      for (const m of mappingsRes.data) {
        if (m.tryon_image_url) {
          metaValue[String(m.shopify_variant_id)] = {
            tryon_image_url:  m.tryon_image_url,
            image_type:       m.image_type      || "flat_lay",
            garment_type:     m.garment_type    || "top",
            avatar_sex:       m.avatar_sex      || null,
            clothing_prompt:  m.clothing_prompt || null,
          };
        }
      }
      await admin.graphql(
        `#graphql
          mutation SetVariantMappings($input: ProductInput!) {
            productUpdate(input: $input) { product { id } }
          }
        `,
        {
          variables: {
            input: {
              id: product_gid,
              metafields: [{
                namespace: "tryfit",
                key:       "variant_mappings",
                value:     JSON.stringify(metaValue),
                type:      "json",
              }],
            },
          },
        }
      );
    }
  }

  return { ok: true, error: null, variant_id: body.shopify_variant_id };
}

const IMAGE_TYPE_OPTIONS = [
  { label: "Flat lay",          value: "flat_lay"         },
  { label: "Ghost mannequin",   value: "ghost_mannequin"  },
  { label: "On model",          value: "on_model"         },
];

const AVATAR_SEX_OPTIONS = [
  { label: "Auto-detect", value: ""       },
  { label: "Male",        value: "male"   },
  { label: "Female",      value: "female" },
];

const GARMENT_TYPE_OPTIONS = [
  { label: "Top wear (shirt, kurti, jacket…)",  value: "top"    },
  { label: "Bottom wear (pants, skirt…)",       value: "bottom" },
  { label: "Full body (saree, dress, jumpsuit…)", value: "full" },
];

function VariantRow({ variant, mapping, productImages, internalProductId, productGid, shopifyProductId }) {
  const submit     = useSubmit();
  const navigation = useNavigation();
  const numericId  = variant.id.replace("gid://shopify/ProductVariant/", "");

  const [imageUrl,     setImageUrl]     = useState(mapping?.tryon_image_url ?? "");
  const [imageType,    setImageType]    = useState(mapping?.image_type      ?? "flat_lay");
  const [garmentType,  setGarmentType]  = useState(mapping?.garment_type    ?? "top");
  const [avatarSex,    setAvatarSex]    = useState(mapping?.avatar_sex      ?? "");
  const [prompt,       setPrompt]       = useState(mapping?.clothing_prompt ?? "");
  const [saved,      setSaved]      = useState(false);
  const [saveError,  setSaveError]  = useState(null);

  const actionData = useActionData();

  // Synchronize state when mapping prop changes (or after successful save)
  useEffect(() => {
    setImageUrl(mapping?.tryon_image_url ?? "");
    setImageType(mapping?.image_type      ?? "flat_lay");
    setGarmentType(mapping?.garment_type  ?? "top");
    setAvatarSex(mapping?.avatar_sex      ?? "");
    setPrompt(mapping?.clothing_prompt ?? "");
  }, [mapping]);

  // Handle save response for THIS variant only
  useEffect(() => {
    if (!actionData || String(actionData.variant_id) !== numericId) return;
    if (actionData.ok) {
      setSaved(true);
      setSaveError(null);
      const timer = setTimeout(() => setSaved(false), 2000);
      return () => clearTimeout(timer);
    } else {
      setSaveError(actionData.error ?? "Save failed. Please try again.");
    }
  }, [actionData, numericId]);

  const isMapped = Boolean(mapping?.tryon_image_url);
  // navigation.formData is null for JSON submissions; use navigation.json instead
  const isSaving = navigation.state === "submitting" &&
    String(navigation.json?.shopify_variant_id ?? navigation.formData?.get("shopify_variant_id")) === numericId;

  const imageOptions = [
    { label: "Enter URL below", value: "" },
    ...productImages.map((img) => ({
      label: img.altText || img.url.split("/").pop() || "Image",
      value: img.url,
    })),
    ...(variant.image?.url
      ? [{ label: "Variant image", value: variant.image.url }]
      : []),
  ];

  const handleSave = () => {
    if (!imageUrl.trim()) return;
    setSaved(false);
    setSaveError(null);
    // mapping.product_id = PHP's internal FK (most reliable source)
    // mapping.id / mapping_id / variant_id = existing record's PK for upsert
    const phpProductId   = mapping?.product_id ?? internalProductId;
    const existingId     = mapping?.id ?? mapping?.mapping_id ?? mapping?.variant_id ?? null;
    submit(
      {
        ...(existingId ? { mapping_id: existingId } : {}),
        product_id:          phpProductId,
        shopify_product_id:  shopifyProductId ?? null,
        product_gid:         productGid,
        shopify_variant_id:  numericId,
        shopify_variant_gid: variant.id,
        variant_title:       variant.title,
        tryon_image_url:     imageUrl.trim(),
        image_type:          imageType,
        garment_type:        garmentType,
        avatar_sex:          avatarSex || null,
        clothing_prompt:     prompt.trim() || null,
      },
      { method: "post", encType: "application/json" }
    );
  };

  return (
    <BlockStack gap="300">
      {saveError && (
        <Banner tone="critical" onDismiss={() => setSaveError(null)}>
          <p>{saveError}</p>
        </Banner>
      )}
      <InlineStack align="space-between" blockAlign="center">
        <InlineStack gap="200" blockAlign="center">
          {variant.image?.url && (
            <Thumbnail source={variant.image.url} alt={variant.title} size="small" />
          )}
          <Text as="h3" variant="bodyMd" fontWeight="semibold">{variant.title}</Text>
        </InlineStack>
        <Badge tone={isMapped ? "success" : "attention"}>
          {isMapped ? "Mapped" : "Not mapped"}
        </Badge>
      </InlineStack>

      {imageOptions.length > 1 && (
        <Select
          label="Pick from product images"
          options={imageOptions}
          value={imageOptions.find((o) => o.value === imageUrl) ? imageUrl : ""}
          onChange={(v) => { if (v) setImageUrl(v); }}
        />
      )}

      <TextField
        label="Try-on image URL"
        value={imageUrl}
        onChange={setImageUrl}
        placeholder="https://..."
        autoComplete="off"
      />

      <Select
        label="Garment type"
        options={GARMENT_TYPE_OPTIONS}
        value={garmentType}
        onChange={setGarmentType}
        helpText="Controls how the try-on result is composited. Top wear preserves the original lower body."
      />

<InlineStack gap="300" wrap>
        <div style={{ flex: 1 }}>
          <Select
            label="Image type"
            options={IMAGE_TYPE_OPTIONS}
            value={imageType}
            onChange={setImageType}
          />
        </div>
        <div style={{ flex: 1 }}>
          <Select
            label="Avatar sex"
            options={AVATAR_SEX_OPTIONS}
            value={avatarSex}
            onChange={setAvatarSex}
          />
        </div>
      </InlineStack>

      <TextField
        label="Clothing prompt (optional, max 200 chars)"
        value={prompt}
        onChange={(v) => {
          const trimmed = v.slice(0, 200);
          setPrompt(trimmed);
          // Auto-correct garment type when prompt mentions full-body garments
          const lower = trimmed.toLowerCase();
          if (/\b(saree|sari|lehenga|gown|dress|jumpsuit|anarkali|abaya|salwar\s*kameez)\b/.test(lower)) {
            setGarmentType("full");
          }
        }}
        multiline={2}
        maxLength={200}
        showCharacterCount
        autoComplete="off"
        placeholder="e.g. red cotton t-shirt with white logo"
      />

      <Button
        variant="primary"
        size="slim"
        onClick={handleSave}
        loading={isSaving}
        disabled={!imageUrl.trim() || !internalProductId}
      >
        {saved ? "Saved!" : "Save"}
      </Button>
    </BlockStack>
  );
}

export default function Variants() {
  const { product, variants, mappings, productImages, internalId, productId, syncError } = useLoaderData();
  const navigate = useNavigate();

  if (!product) {
    return (
      <Page title="Variant Mappings" backAction={{ onAction: () => navigate("/app/products"), content: "Products" }}>
        <Text as="p">No product selected. Go back to Products.</Text>
      </Page>
    );
  }

  const mappingsByVariant = {};
  for (const m of mappings) {
    mappingsByVariant[String(m.shopify_variant_id)] = m;
  }

  return (
    <Page
      title={`Variant Mappings — ${product.title}`}
      backAction={{ onAction: () => navigate("/app/products"), content: "Products" }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {syncError && (
              <Banner tone="critical">
                <p>{syncError}</p>
              </Banner>
            )}

            {variants.map((variant, idx) => {
              const numericId = variant.id.replace("gid://shopify/ProductVariant/", "");
              return (
                <Card key={variant.id}>
                  <VariantRow
                    variant={variant}
                    mapping={mappingsByVariant[numericId] ?? null}
                    productImages={productImages}
                    internalProductId={internalId}
                    productGid={product.id}
                    shopifyProductId={productId}
                  />
                  {idx < variants.length - 1 && <Divider />}
                </Card>
              );
            })}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
