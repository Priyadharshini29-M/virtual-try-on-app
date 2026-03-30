import { useLoaderData, useActionData, useNavigation, useSubmit } from "react-router";
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
  ChoiceList,
  Button,
  Toast,
  Frame,
  Divider,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import phpApiClient from "../lib/php-api.server";
import { ensureMerchant } from "../lib/merchant.server";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);
  const api = phpApiClient(apiKey, process.env.PHP_API_URL ?? "");
  const res = await api.getSettings();
  return { settings: res.ok ? res.data ?? null : null };
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);
  const body = await request.json();
  const api  = phpApiClient(apiKey, process.env.PHP_API_URL ?? "");
  const res  = await api.saveSettings(body);
  return { ok: res.ok, error: res.error ?? null };
}

const POSITION_OPTIONS = [
  { label: "Below product images", value: "below_images" },
  { label: "Below Add to Cart",    value: "below_atc"    },
  { label: "Floating button",      value: "floating"     },
];

const LANGUAGE_OPTIONS = [
  { label: "English", value: "en" },
  { label: "Tamil",   value: "ta" },
  { label: "Hindi",   value: "hi" },
];

export default function Settings() {
  const { settings }  = useLoaderData();
  const actionData    = useActionData();
  const navigation    = useNavigation();
  const submit        = useSubmit();
  const isSubmitting  = navigation.state === "submitting";

  const [toastActive,     setToastActive]     = useState(false);
  const [buttonText,      setButtonText]      = useState(settings?.button_text      ?? "Try On This Look");
  const [buttonColor,     setButtonColor]     = useState(settings?.button_color     ?? "#1B3A6B");
  const [buttonTextColor, setButtonTextColor] = useState(settings?.button_text_color ?? "#FFFFFF");
  const [buttonPosition,  setButtonPosition]  = useState([settings?.button_position ?? "below_images"]);
  const [language,        setLanguage]        = useState(settings?.widget_language  ?? "en");
  const [shareWa,         setShareWa]         = useState(Boolean(settings?.share_whatsapp_enabled ?? true));
  const [saveImg,         setSaveImg]         = useState(Boolean(settings?.save_image_enabled     ?? true));
  const [privacy,         setPrivacy]         = useState(Boolean(settings?.privacy_notice_shown   ?? true));

  useEffect(() => {
    if (actionData?.ok) setToastActive(true);
  }, [actionData]);

  const handleSave = () => {
    submit(
      {
        button_text:             buttonText,
        button_color:            buttonColor,
        button_text_color:       buttonTextColor,
        button_position:         buttonPosition[0],
        widget_language:         language,
        share_whatsapp_enabled:  shareWa,
        save_image_enabled:      saveImg,
        privacy_notice_shown:    privacy,
      },
      { method: "post", encType: "application/json" }
    );
  };

  return (
    <Frame>
      {toastActive && (
        <Toast content="Settings saved!" onDismiss={() => setToastActive(false)} />
      )}
      <Page
        title="Widget Settings"
        primaryAction={{ content: "Save", onAction: handleSave, loading: isSubmitting }}
      >
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">

                <Text as="h2" variant="headingMd">Button appearance</Text>

                <TextField
                  label="Button text"
                  value={buttonText}
                  onChange={setButtonText}
                  maxLength={100}
                  autoComplete="off"
                />

                <InlineStack gap="300" wrap>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Button color (hex)"
                      value={buttonColor}
                      onChange={setButtonColor}
                      autoComplete="off"
                      placeholder="#1B3A6B"
                      prefix={
                        <span
                          style={{
                            display: "inline-block",
                            width: 16,
                            height: 16,
                            background: /^#[0-9A-Fa-f]{6}$/.test(buttonColor) ? buttonColor : "#ccc",
                            borderRadius: 2,
                            border: "1px solid #ccc",
                          }}
                        />
                      }
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Button text color (hex)"
                      value={buttonTextColor}
                      onChange={setButtonTextColor}
                      autoComplete="off"
                      placeholder="#FFFFFF"
                      prefix={
                        <span
                          style={{
                            display: "inline-block",
                            width: 16,
                            height: 16,
                            background: /^#[0-9A-Fa-f]{6}$/.test(buttonTextColor) ? buttonTextColor : "#ccc",
                            borderRadius: 2,
                            border: "1px solid #ccc",
                          }}
                        />
                      }
                    />
                  </div>
                </InlineStack>

                <Divider />

                <ChoiceList
                  title="Button position"
                  choices={POSITION_OPTIONS}
                  selected={buttonPosition}
                  onChange={setButtonPosition}
                />

                <Select
                  label="Widget language"
                  options={LANGUAGE_OPTIONS}
                  value={language}
                  onChange={setLanguage}
                />

                <Divider />

                <Text as="h2" variant="headingMd">Features</Text>

                <ChoiceList
                  title="WhatsApp share"
                  choices={[{ label: "Enable WhatsApp share button", value: "yes" }]}
                  selected={shareWa ? ["yes"] : []}
                  onChange={(v) => setShareWa(v.includes("yes"))}
                  allowMultiple
                />

                <ChoiceList
                  title="Save image"
                  choices={[{ label: "Allow customers to save try-on image", value: "yes" }]}
                  selected={saveImg ? ["yes"] : []}
                  onChange={(v) => setSaveImg(v.includes("yes"))}
                  allowMultiple
                />

                <ChoiceList
                  title="Privacy notice"
                  choices={[{ label: "Show privacy notice before upload", value: "yes" }]}
                  selected={privacy ? ["yes"] : []}
                  onChange={(v) => setPrivacy(v.includes("yes"))}
                  allowMultiple
                />

              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </Frame>
  );
}
