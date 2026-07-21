import type { OutletProfile, OutletReferencePoint } from "../types";
import { GENERATED_OUTLETS, OUTLET_DATA_GENERATED_AT, OUTLET_DATA_SOURCES } from "./outlet-data.generated";
import type { GeneratedOutlet } from "./outlet-data.generated";

export { OUTLET_DATA_SOURCES, OUTLET_DATA_GENERATED_AT };

export const OUTLET_PLACEMENT_DISCLAIMER =
  "Placement comes from two published research datasets, not from Ellipsis. The vertical axis is an expert-rated journalistic-quality score; the horizontal axis is how a US voter-matched panel shared the outlet, which reflects its American audience rather than its editorial stance. It describes the outlet, not this article.";

/**
 * DomainDemo is built from a US voter-registration panel, so a non-US outlet's
 * score reflects which Americans share it. UK papers in particular land far
 * from where their domestic politics would put them.
 */
export const OUTLET_NON_US_CAVEAT =
  "This outlet is based outside the United States, so its audience score reflects which US readers share it and not its position in its own country's politics.";

const STRIPPED_SUBDOMAINS = /^(?:www|m|mobile|amp|edition|beta|es|en|es-us|news|live)\./;

export function normalizeOutletHost(urlOrHost: string): string {
  const value = String(urlOrHost || "").trim();
  if (!value) return "";
  let host = value;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      host = new URL(value).hostname;
    } catch {
      return "";
    }
  }
  host = host.toLowerCase().replace(/\.$/, "");
  while (STRIPPED_SUBDOMAINS.test(host)) host = host.replace(STRIPPED_SUBDOMAINS, "");
  return host;
}

function matchRecord(host: string): GeneratedOutlet | undefined {
  if (!host) return undefined;
  return GENERATED_OUTLETS.find((record) => record.hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`)));
}

function placementFor(record: GeneratedOutlet) {
  // An outlet can be in our curated metadata but absent from the datasets
  // (Semafor postdates both collections). Show its facts, plot nothing.
  if (record.quality === null || record.partisanship === null) return null;
  const notes = [record.note, record.country === "United States" ? "" : OUTLET_NON_US_CAVEAT, OUTLET_PLACEMENT_DISCLAIMER];
  return {
    quality: record.quality,
    partisanship: record.partisanship,
    note: notes.filter(Boolean).join(" ")
  };
}

export function lookupBundledOutlet(urlOrHost: string): OutletProfile | undefined {
  const host = normalizeOutletHost(urlOrHost);
  const record = matchRecord(host);
  if (!record) return undefined;
  return {
    host: record.hosts[0],
    name: record.name,
    origin: "bundled-dataset",
    headquarters: record.headquarters,
    country: record.country,
    ownership: record.ownership,
    funding: record.funding,
    founded: record.founded,
    medium: record.medium,
    icon: record.icon,
    placement: placementFor(record),
    citations: OUTLET_DATA_SOURCES.map((source) => ({ url: source.url, label: source.citation })),
    generatedAt: new Date().toISOString()
  };
}

export function referenceOutlets(excludeHost = ""): OutletReferencePoint[] {
  const excludedRecord = matchRecord(normalizeOutletHost(excludeHost));
  return GENERATED_OUTLETS.filter(
    (record) => record.reference && record !== excludedRecord && record.quality !== null && record.partisanship !== null
  ).map((record) => ({
    name: record.name,
    host: record.hosts[0],
    quality: record.quality as number,
    partisanship: record.partisanship as number,
    icon: record.icon
  }));
}

export function qualityLabel(value: number) {
  if (value >= 85) return "Very high rated quality";
  if (value >= 70) return "High rated quality";
  if (value >= 55) return "Moderate rated quality";
  if (value >= 40) return "Low rated quality";
  return "Very low rated quality";
}

/**
 * Deliberately phrased as sharing behaviour. Calling a negative score "left"
 * would misread the measure: wire services sit near -22 here because US
 * Democrats share them more, not because they report from the left.
 */
export function partisanshipLabel(value: number) {
  if (value <= -40) return "Shared mainly by Democrats";
  if (value <= -15) return "Shared more by Democrats";
  if (value < 15) return "Shared across both parties";
  if (value < 40) return "Shared more by Republicans";
  return "Shared mainly by Republicans";
}

export function clampPlacement(profile: OutletProfile): OutletProfile {
  if (!profile.placement) return profile;
  return {
    ...profile,
    placement: {
      ...profile.placement,
      quality: Math.min(100, Math.max(0, profile.placement.quality)),
      partisanship: Math.min(100, Math.max(-100, profile.placement.partisanship))
    }
  };
}
