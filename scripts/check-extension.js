const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(projectRoot, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const referencedFiles = [
  ...manifest.background.scripts,
  manifest.action.default_icon,
  manifest.options_ui.page,
  ...manifest.web_accessible_resources.flatMap((entry) => entry.resources),
];

for (const relativePath of referencedFiles) {
  const absolutePath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Manifest references a missing file: ${relativePath}`);
  }
}

if (manifest.manifest_version !== 3) {
  throw new Error("Expected a Manifest V3 extension.");
}

if (manifest.browser_specific_settings?.gecko?.data_collection_permissions?.required?.[0] !== "none") {
  throw new Error("The manifest must explicitly declare that no data leaves the extension.");
}

console.log(`manifest.json is valid JSON and all ${referencedFiles.length} referenced files exist.`);
