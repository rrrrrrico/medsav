#!/usr/bin/env node
/**
 * Convert med-data JSON (plans.json + plan-premium.json) into CSV files
 * consumed by the frontend.
 *
 * Usage:
 *   node scripts/convert-med-data.mjs [path-to-med-data-dir]
 *
 * Defaults to ../../Documents/med-data relative to this repo, or MED_DATA_DIR.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const medDataDir =
  process.argv[2] ||
  process.env.MED_DATA_DIR ||
  path.resolve(root, "../Documents/med-data");

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const plans = JSON.parse(
  fs.readFileSync(path.join(medDataDir, "plans.json"), "utf8")
);
const premiumData = JSON.parse(
  fs.readFileSync(path.join(medDataDir, "plan-premium.json"), "utf8")
);
const premiums = premiumData["certified-plans"];

const planHeaders = [
  "certification_no",
  "company_name_en",
  "company_name_zh",
  "plan_name_en",
  "plan_name_zh",
  "type_en",
  "type_zh",
];
const planRows = plans.map((p) =>
  [
    p["certification-no"],
    p.company_name_en,
    p.company_name_zh,
    p.plan_name_en,
    p.plan_name_zh,
    p.type_en,
    p.type_zh,
  ]
    .map(csvEscape)
    .join(",")
);

const ages = Array.from({ length: 81 }, (_, i) => String(i));
const premHeaders = [
  "certification_no",
  "prem_date",
  "currency",
  "age_counting_method",
  "status",
  ...ages,
];
const premRows = [];
for (const p of premiums) {
  for (const [status, ageMap] of Object.entries(p.premium || {})) {
    if (!ageMap || typeof ageMap !== "object") continue;
    premRows.push(
      [
        p["certification-no"],
        p["prem-date"],
        p.currency,
        p["age-counting-method"],
        status,
        ...ages.map((a) => (ageMap[a] != null ? ageMap[a] : "")),
      ]
        .map(csvEscape)
        .join(",")
    );
  }
}

const outDir = path.join(root, "public", "data");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "plans.csv"),
  [planHeaders.join(","), ...planRows].join("\n") + "\n"
);
fs.writeFileSync(
  path.join(outDir, "premiums.csv"),
  [premHeaders.join(","), ...premRows].join("\n") + "\n"
);

console.log(`Wrote ${planRows.length} plans → public/data/plans.csv`);
console.log(`Wrote ${premRows.length} premium rows → public/data/premiums.csv`);
