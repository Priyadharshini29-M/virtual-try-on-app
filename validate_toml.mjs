import { loadLocalExtensionsSpecifications } from "file:///C:/Users/Admin/AppData/Roaming/npm/node_modules/@shopify/app/dist/cli/models/extensions/load-specifications.js";
import { getAppVersionedSchema } from "file:///C:/Users/Admin/AppData/Roaming/npm/node_modules/@shopify/app/dist/cli/models/app/app.js";
import { deepStrict } from "file:///C:/Users/Admin/AppData/Roaming/npm/node_modules/@shopify/app/node_modules/@shopify/cli-kit/dist/public/node/schema.js";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const toml = require("C:/Users/Admin/AppData/Roaming/npm/node_modules/@shopify/app/node_modules/@iarna/toml");
const fs = require("fs");

const content = fs.readFileSync(
  "d:/Digifyce/FitFyce/FitFyce/fitfyce-shopify/shopify.app.toml",
  "utf8",
);
const parsed = toml.parse(content);
console.log("Parsed TOML keys:", Object.keys(parsed));

const specs = await loadLocalExtensionsSpecifications();
console.log(
  "Config specs:",
  specs
    .filter((s) => s.experience === "configuration")
    .map((s) => s.identifier),
);

// Test merged schema
const schema = getAppVersionedSchema(specs);
const strictSchema = deepStrict(schema);
const result = strictSchema.safeParse(parsed);
if (!result.success) {
  console.log("\nMERGED SCHEMA ERRORS:");
  result.error.issues.forEach((i) =>
    console.log(`  [${i.path.join(".")}]: ${i.message}`),
  );
} else {
  console.log("\nMERGED SCHEMA: OK");
}

// Test each config spec independently
const configSpecs = specs.filter((s) => s.experience === "configuration");
for (const spec of configSpecs) {
  const r = spec.schema.safeParse(parsed);
  if (!r.success) {
    console.log(`\nSPEC [${spec.identifier}] ERRORS:`);
    r.error.issues.forEach((i) =>
      console.log(`  [${i.path.join(".")}]: ${i.message}`),
    );
  } else {
    console.log(`SPEC [${spec.identifier}]: OK`);
  }
}
