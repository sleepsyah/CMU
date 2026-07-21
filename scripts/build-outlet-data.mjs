#!/usr/bin/env node
// Regenerates src/lib/outlet-data.generated.ts from published research datasets.
//
// Placement scores are never hand-written. They are joined from two openly
// published, citable datasets:
//
//   Journalistic quality (Y axis)
//     Lin, H., Lasser, J., Lewandowsky, S., Cole, R., Gully, A., Rand, D. G.,
//     & Pennycook, G. (2023). High level of correspondence across different
//     news domain quality rating sets. PNAS Nexus, 2(9), pgad286.
//     https://doi.org/10.1093/pnasnexus/pgad286
//     We use `pc1`, the first principal component across six expert rating
//     sets, rescaled 0-100.
//
//   US audience partisanship (X axis)
//     Yang, K.-C., Goel, P., Quintana-Mathé, A., Horgan, L., McCabe, S. D.,
//     Grinberg, N., Joseph, K., & Lazer, D. (2025). DomainDemo: a dataset of
//     domain-sharing activities among different demographic groups on
//     Twitter. Scientific Data, 12(1), 1251.
//     https://doi.org/10.1038/s41597-025-05604-6
//     We use `leaning_score` from the public derived metrics, rescaled
//     -100 (shared mainly by registered Democrats) to +100 (Republicans).
//
// Editorial metadata (ownership, funding, headquarters) stays hand-curated in
// data/outlets.json — those are descriptive facts, not scores.
//
// Usage: npm run data:outlets

import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, "data", ".cache");
const ICON_DIR = join(ROOT, "public", "icons", "outlets");
const OUT = join(ROOT, "src", "lib", "outlet-data.generated.ts");

const QUALITY_URL = "https://raw.githubusercontent.com/hauselin/domain-quality-ratings/main/data/domain_pc1.csv";
const PARTISANSHIP_URL = "https://raw.githubusercontent.com/LazerLab/DomainDemo/main/data/derived_metrics/derived_party_leaning.csv.gz";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const MAX_ICON_BYTES = 60_000;

async function cachedFetch(url, { binary = false } = {}) {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, `${createHash("sha1").update(url).digest("hex")}${binary ? ".bin" : ".txt"}`);
  if (existsSync(file)) return binary ? readFileSync(file) : readFileSync(file, "utf8");
  const response = await fetch(url, { headers: { "user-agent": UA } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(file, buffer);
  return binary ? buffer : buffer.toString("utf8");
}

function parseCsv(text) {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const columns = header.split(",");
  return lines.map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(columns.map((column, index) => [column, cells[index]]));
  });
}

// The two datasets key on registrable domains, so match the most specific host
// we have a score for rather than assuming outlets[].hosts[0] is present.
function lookup(map, hosts) {
  for (const host of hosts) {
    if (map.has(host)) return { host, value: map.get(host) };
  }
  return null;
}

function iconSlug(host) {
  return host.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

function resolveIconCandidates(html, origin) {
  const candidates = [];
  const linkRe = /<link\b[^>]*>/gi;
  for (const [tag] of html.matchAll(linkRe)) {
    const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase() ?? "";
    if (!/\b(icon|shortcut icon|apple-touch-icon)\b/.test(rel)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)/i.exec(tag)?.[1];
    if (!href) continue;
    const sizes = /\bsizes\s*=\s*["']?(\d+)/i.exec(tag)?.[1];
    try {
      candidates.push({ url: new URL(href, origin).href, size: sizes ? Number(sizes) : 0 });
    } catch {
      /* skip unparseable href */
    }
  }
  // Prefer icons nearest 64px — big enough to stay sharp on the chart, small
  // enough that we are not embedding a 512px marketing asset per outlet.
  candidates.sort((a, b) => Math.abs((a.size || 32) - 64) - Math.abs((b.size || 32) - 64));
  candidates.push({ url: new URL("/favicon.ico", origin).href, size: 0 });
  return candidates;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ICO_MAGIC = Buffer.from([0x00, 0x00, 0x01, 0x00]);

// Multi-resolution .ico files bundle every size an outlet ships (HuffPost's is
// 200KB). We only ever draw one small marker, so pull out the single frame
// nearest 64px. Modern icons embed PNG frames, which we can write straight out.
function extractIcoFrame(buffer) {
  if (!buffer.subarray(0, 4).equals(ICO_MAGIC) || buffer.length < 22) return null;
  const count = buffer.readUInt16LE(4);
  let best = null;
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16;
    if (entry + 16 > buffer.length) break;
    const width = buffer[entry] || 256;
    const size = buffer.readUInt32LE(entry + 8);
    const offset = buffer.readUInt32LE(entry + 12);
    if (offset + size > buffer.length) continue;
    const distance = Math.abs(width - 64);
    if (!best || distance < best.distance) best = { distance, offset, size };
  }
  if (!best) return null;
  const frame = buffer.subarray(best.offset, best.offset + best.size);
  return frame.subarray(0, 8).equals(PNG_MAGIC) ? { buffer: frame, extension: "png" } : null;
}

async function fetchIcon(host) {
  // Some outlets only serve the real icon from the www host, and some answer
  // bare /favicon.ico with a bot interstitial, so try both origins.
  const candidates = [];
  for (const origin of [`https://${host}`, `https://www.${host}`]) {
    try {
      candidates.push(...resolveIconCandidates(await cachedFetch(origin), origin));
    } catch {
      candidates.push({ url: `${origin}/favicon.ico`, size: 0 });
    }
  }
  for (const candidate of candidates.slice(0, 12)) {
    try {
      const raw = await cachedFetch(candidate.url, { binary: true });
      if (!raw.length) continue;
      const frame = extractIcoFrame(raw);
      const buffer = frame?.buffer ?? raw;
      const isPng = buffer.subarray(0, 8).equals(PNG_MAGIC);
      const isIco = buffer.subarray(0, 4).equals(ICO_MAGIC);
      const isSvg = /<svg[\s>]/i.test(raw.subarray(0, 512).toString("utf8"));
      if (!isPng && !isIco && !isSvg) continue;
      if (buffer.length > MAX_ICON_BYTES) continue;
      const extension = frame?.extension ?? (isPng ? "png" : isSvg ? "svg" : "ico");
      const name = `${iconSlug(host)}.${extension}`;
      writeFileSync(join(ICON_DIR, name), buffer);
      return `icons/outlets/${name}`;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

async function main() {
  const outlets = JSON.parse(readFileSync(join(ROOT, "data", "outlets.json"), "utf8"));

  process.stdout.write("Downloading quality ratings (Lin et al. 2023)... ");
  const qualityRows = parseCsv(await cachedFetch(QUALITY_URL));
  const quality = new Map(qualityRows.map((row) => [row.domain, Number(row.pc1)]));
  console.log(`${quality.size} domains`);

  process.stdout.write("Downloading audience partisanship (Yang et al. 2025)... ");
  const partisanshipRows = parseCsv(gunzipSync(await cachedFetch(PARTISANSHIP_URL, { binary: true })).toString("utf8"));
  const partisanship = new Map(partisanshipRows.map((row) => [row.domain, Number(row.leaning_score)]));
  console.log(`${partisanship.size} domains`);

  rmSync(ICON_DIR, { recursive: true, force: true });
  mkdirSync(ICON_DIR, { recursive: true });

  const records = [];
  const unmatched = [];
  for (const outlet of outlets) {
    const q = lookup(quality, outlet.hosts);
    const p = lookup(partisanship, outlet.hosts);
    if (!q || !p) {
      unmatched.push(`${outlet.name} (${!q ? "no quality" : ""}${!q && !p ? ", " : ""}${!p ? "no partisanship" : ""})`);
    }
    // Only reference outlets are drawn as fixed points on every chart, so they
    // are the only ones worth shipping an icon for.
    const icon = outlet.reference ? await fetchIcon(outlet.hosts[0]) : null;
    if (outlet.reference) console.log(`  icon ${icon ? "ok  " : "MISS"} ${outlet.hosts[0]}`);
    records.push({
      ...outlet,
      quality: q ? Math.round(q.value * 1000) / 10 : null,
      partisanship: p ? Math.round(p.value * 1000) / 10 : null,
      matchedHost: q?.host ?? p?.host ?? null,
      icon
    });
  }

  const serialize = (value) => JSON.stringify(value);
  const lines = records.map((record) => {
    const fields = [
      `name: ${serialize(record.name)}`,
      `hosts: ${serialize(record.hosts)}`,
      `headquarters: ${serialize(record.headquarters)}`,
      `country: ${serialize(record.country)}`,
      `ownership: ${serialize(record.ownership)}`,
      `funding: ${serialize(record.funding)}`,
      `founded: ${serialize(record.founded)}`,
      `medium: ${serialize(record.medium)}`,
      `quality: ${record.quality}`,
      `partisanship: ${record.partisanship}`,
      `icon: ${serialize(record.icon)}`
    ];
    if (record.note) fields.push(`note: ${serialize(record.note)}`);
    if (record.reference) fields.push("reference: true");
    return `  { ${fields.join(", ")} }`;
  });

  const generated = `// GENERATED FILE — do not edit by hand.
// Run \`npm run data:outlets\` to regenerate from the source datasets.
//
// quality:      0-100, from Lin et al. (2023) PNAS Nexus \`pc1\` — the first
//               principal component across six expert rating sets. Higher =
//               stronger assessed journalistic standards.
// partisanship: -100 to +100, from Yang et al. (2025) Scientific Data
//               DomainDemo \`leaning_score\`. Negative = shared mainly by
//               registered Democrats, positive = by registered Republicans.
//               This measures a US sharing audience, NOT editorial stance.

export interface GeneratedOutlet {
  name: string;
  hosts: string[];
  headquarters: string;
  country: string;
  ownership: string;
  funding: string;
  founded: string;
  medium: string;
  quality: number | null;
  partisanship: number | null;
  icon: string | null;
  note?: string;
  reference?: boolean;
}

export interface OutletDataSource {
  key: "quality" | "partisanship";
  label: string;
  citation: string;
  url: string;
}

export const OUTLET_DATA_SOURCES: OutletDataSource[] = [
  {
    key: "quality",
    label: "Journalistic quality",
    citation:
      "Lin, H., Lasser, J., Lewandowsky, S., Cole, R., Gully, A., Rand, D. G., & Pennycook, G. (2023). High level of correspondence across different news domain quality rating sets. PNAS Nexus, 2(9), pgad286.",
    url: "https://doi.org/10.1093/pnasnexus/pgad286"
  },
  {
    key: "partisanship",
    label: "US audience partisanship",
    citation:
      "Yang, K.-C., Goel, P., Quintana-Mathé, A., Horgan, L., McCabe, S. D., Grinberg, N., Joseph, K., & Lazer, D. (2025). DomainDemo: a dataset of domain-sharing activities among different demographic groups on Twitter. Scientific Data, 12(1), 1251.",
    url: "https://doi.org/10.1038/s41597-025-05604-6"
  }
];

export const OUTLET_DATA_GENERATED_AT = ${serialize(new Date().toISOString().slice(0, 10))};

export const GENERATED_OUTLETS: GeneratedOutlet[] = [
${lines.join(",\n")}
];
`;

  writeFileSync(OUT, generated);
  const withIcons = records.filter((record) => record.icon).length;
  const referenceCount = records.filter((record) => record.reference).length;
  console.log(`\nWrote ${records.length} outlets to ${OUT.replace(ROOT + "/", "")}`);
  console.log(`Icons: ${withIcons}/${referenceCount} reference outlets`);
  if (unmatched.length) console.log(`Unmatched in datasets: ${unmatched.join("; ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
