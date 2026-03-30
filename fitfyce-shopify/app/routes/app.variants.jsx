import { useLoaderData, useSubmit, useNavigation, useActionData } from "react-router";
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
  Divider,
  Thumbnail,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import phpApiClient from "../lib/php-api.server";
import { ensureMerchant } from "../lib/merchant.server";

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

  const api = phpApiClient(apiKey, process.env.PHP_API_URL ?? "");

  const syncRes  = await api.syncProduct({
    shopify_product_id:  productId,
    shopify_product_gid: productGid,
    title:               product?.title  ?? "",
    handle:              product?.handle ?? "",
    is_tryon_enabled: 1,
  });

  const internalId = syncRes.ok ? syncRes.data?.id : null;

  const mappingsRes = internalId
    ? await api.getVariantMappings(internalId)
    : { ok: true, data: [] };
  const mappings = mappingsRes.ok ? mappingsRes.data ?? [] : [];

  return { product, variants, mappings, productImages, internalId, productId };
}

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);
  const body = await request.json();
  const api  = phpApiClient(apiKey, process.env.PHP_API_URL ?? "");

  const res = await api.saveVariantMapping(body);
  if (!res.ok) return { ok: false, error: res.error ?? null };

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
            image_type:       m.image_type       || "flat_lay",
            avatar_sex:       m.avatar_sex        || null,
            clothing_prompt:  m.clothing_prompt   || null,
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

function VariantRow({ variant, mapping, productImages, internalProductId, productGid }) {
  const submit     = useSubmit();
  const navigation = useNavigation();
  const numericId  = variant.id.replace("gid://shopify/ProductVariant/", "");

  const [imageUrl,       setImageUrl]       = useState(mapping?.tryon_image_url ?? "");
  const [imageType,      setImageType]      = useState(mapping?.image_type      ?? "flat_lay");
  const [avatarSex,      setAvatarSex]      = useState(mapping?.avatar_sex      ?? "");
  const [prompt,         setPrompt]         = useState(mapping?.clothing_prompt ?? "");
  const [saved,          setSaved]          = useState(false);

  const actionData = useActionData();

  // Synchronize state when mapping prop changes (or after successful save)
  useEffect(() => {
    setImageUrl(mapping?.tryon_image_url ?? "");
    setImageType(mapping?.image_type      ?? "flat_lay");
    setAvatarSex(mapping?.avatar_sex      ?? "");
    setPrompt(mapping?.clothing_prompt ?? "");
  }, [mapping]);

  // Show "Saved!" toast only if action was successful for THIS variant
  useEffect(() => {
    if (actionData?.ok && actionData?.variant_id === numericId) {
      setSaved(true);
      const timer = setTimeout(() => setSaved(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [actionData, numericId]);

  const isMapped  = Boolean(mapping?.tryon_image_url);
  const isSaving  = navigation.state === "submitting" && 
                    navigation.formData?.get("shopify_variant_id") === numericId;

  const imageOptions = [
    { label: "Enter URL below", value: "" },
    ...productImages.map((img) => ({
      label: img.altText ?? img.url.split("/").pop() ?? "Image",
      value: img.url,
    })),
    ...(variant.image?.url
      ? [{ label: "Variant image", value: variant.image.url }]
      : []),
  ];

  const handleSave = () => {
    if (!imageUrl.trim()) return;
    setSaved(false); // Reset before submitting
    submit(
      {
        product_id:           internalProductId,
        product_gid:          productGid,
        shopify_variant_id:   numericId,
        shopify_variant_gid:  variant.id,
        variant_title:        variant.title,
        tryon_image_url:      imageUrl.trim(),
        image_type:           imageType,
        avatar_sex:           avatarSex || null,
        clothing_prompt:      prompt.trim() || null,
      },
      { method: "post", encType: "application/json" }
    );
  };

  return (
    <BlockStack gap="300">
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
        onChange={(v) => setPrompt(v.slice(0, 200))}
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
        disabled={!imageUrl.trim()}
      >
        {saved ? "Saved!" : "Save"}
      </Button>
    </BlockStack>
  );
}

export default function Variants() {
  const { product, variants, mappings, productImages, internalId, productId } = useLoaderData();

  if (!product) {
    return (
      <Page title="Variant Mappings" backAction={{ url: "/app/products", content: "Products" }}>
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
      backAction={{ url: "/app/products", content: "Products" }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
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
