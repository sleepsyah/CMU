import { useMemo, useState } from "react";
import { LinkSimple } from "@phosphor-icons/react";
import type { Analysis, OutletProfile, OutletReferencePoint } from "../../types";
import {
  OUTLET_DATA_GENERATED_AT,
  OUTLET_DATA_SOURCES,
  OUTLET_PLACEMENT_DISCLAIMER,
  partisanshipLabel,
  qualityLabel,
  referenceOutlets
} from "../../lib/outlet";

const PLOT = { width: 340, height: 260, left: 34, right: 14, top: 16, bottom: 46 };
const ICON = 15;
const CURRENT_ICON = 21;

interface PlottedOutlet extends OutletReferencePoint {
  current?: boolean;
}

// The measure runs -100..100 but real outlets occupy a narrower band, so fit
// the axis to the data. Keeping it symmetric leaves the dataset's own zero in
// the visual centre instead of implying a shifted midpoint.
function partisanshipDomain(points: PlottedOutlet[]) {
  const widest = points.reduce((max, point) => Math.max(max, Math.abs(point.partisanship)), 0);
  return Math.min(100, Math.max(40, Math.ceil(widest / 10) * 10 + 5));
}

interface PlacedOutlet extends PlottedOutlet {
  x: number;
  y: number;
}

/**
 * Several outlets sit almost exactly on top of one another — the wire services
 * are ~3px apart, NPR and The Economist ~1px — which is unreadable once each
 * point is a 15px icon. Nudge overlapping markers apart just enough to stay
 * legible, holding the analysed outlet at its true position and leaving the
 * tooltip and table to report exact values. Deterministic so renders are stable.
 */
function relaxCollisions(points: PlottedOutlet[], plotX: (value: number) => number, plotY: (value: number) => number): PlacedOutlet[] {
  const nodes: PlacedOutlet[] = points.map((point) => ({ ...point, x: plotX(point.partisanship), y: plotY(point.quality) }));
  const minimum = ICON + 2;
  for (let pass = 0; pass < 90; pass += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        if (distance >= minimum) continue;
        if (distance < 0.01) {
          // Identical positions have no separating direction; split them along
          // a fixed diagonal derived from index so the result stays stable.
          dx = (j % 2 === 0 ? 1 : -1) * 0.7;
          dy = (j % 3 === 0 ? 1 : -1) * 0.7;
          distance = Math.hypot(dx, dy);
        }
        const shift = ((minimum - distance) / 2) * 0.5;
        const ux = (dx / distance) * shift;
        const uy = (dy / distance) * shift;
        if (!a.current) {
          a.x -= ux;
          a.y -= uy;
        }
        if (!b.current) {
          b.x += ux;
          b.y += uy;
        }
      }
    }
    for (const node of nodes) {
      node.x = Math.min(PLOT.width - PLOT.right - ICON / 2, Math.max(PLOT.left + ICON / 2, node.x));
      node.y = Math.min(PLOT.height - PLOT.bottom - ICON / 2, Math.max(PLOT.top + ICON / 2, node.y));
    }
  }
  return nodes;
}

function OutletMarker({ point }: { point: PlacedOutlet }) {
  const [failed, setFailed] = useState(false);
  const size = point.current ? CURRENT_ICON : ICON;
  const x = point.x - size / 2;
  const y = point.y - size / 2;
  const clipId = `outlet-clip-${point.host.replace(/[^a-z0-9]/gi, "")}`;
  const initials = point.name.replace(/^The\s+/i, "").slice(0, 1).toUpperCase();

  if (!point.icon || failed) {
    return (
      <g className={point.current ? "outlet-marker is-current" : "outlet-marker"}>
        <circle cx={x + size / 2} cy={y + size / 2} r={size / 2} className="outlet-monogram-bg" />
        <text x={x + size / 2} y={y + size / 2} className="outlet-monogram" dominantBaseline="central" textAnchor="middle">
          {initials}
        </text>
      </g>
    );
  }
  return (
    <g className={point.current ? "outlet-marker is-current" : "outlet-marker"}>
      <clipPath id={clipId}>
        <circle cx={x + size / 2} cy={y + size / 2} r={size / 2} />
      </clipPath>
      <circle cx={x + size / 2} cy={y + size / 2} r={size / 2} className="outlet-marker-bg" />
      <image
        href={point.icon}
        x={x}
        y={y}
        width={size}
        height={size}
        clipPath={`url(#${clipId})`}
        preserveAspectRatio="xMidYMid slice"
        onError={() => setFailed(true)}
      />
      <circle cx={x + size / 2} cy={y + size / 2} r={size / 2} className="outlet-marker-ring" />
    </g>
  );
}

function OutletPlacementChart({ profile }: { profile: OutletProfile }) {
  const placement = profile.placement;
  const [hovered, setHovered] = useState<PlacedOutlet | null>(null);
  const points = useMemo<PlottedOutlet[]>(() => {
    const references = referenceOutlets(profile.host);
    if (!placement) return references;
    return [
      ...references,
      {
        name: profile.name,
        host: profile.host,
        quality: placement.quality,
        partisanship: placement.partisanship,
        icon: profile.icon,
        current: true
      }
    ];
  }, [profile, placement]);
  const domain = partisanshipDomain(points);
  const span = PLOT.width - PLOT.left - PLOT.right;
  const plotX = (value: number) => PLOT.left + ((value + domain) / (domain * 2)) * span;
  const plotY = (value: number) => PLOT.top + (1 - value / 100) * (PLOT.height - PLOT.top - PLOT.bottom);
  const placed = useMemo(() => relaxCollisions(points, plotX, plotY), [points, domain]);
  if (!placement) return null;

  const gridY = [0, 25, 50, 75, 100];

  return (
    <div className="outlet-chart">
      <div className="outlet-chart-frame">
        <svg
          viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
          role="img"
          aria-label={`Chart placing ${profile.name} at rated journalistic quality ${Math.round(placement.quality)} of 100, ${partisanshipLabel(placement.partisanship).toLowerCase()}, among ${points.length - 1} reference outlets.`}
        >
          {gridY.map((value) => (
            <line key={value} x1={PLOT.left} x2={PLOT.width - PLOT.right} y1={plotY(value)} y2={plotY(value)} className="outlet-grid" />
          ))}
          <line x1={plotX(0)} x2={plotX(0)} y1={PLOT.top} y2={PLOT.height - PLOT.bottom} className="outlet-grid is-mid" />
          {gridY.map((value) => (
            <text key={value} x={PLOT.left - 6} y={plotY(value) + 3} textAnchor="end" className="outlet-tick">
              {value}
            </text>
          ))}
          <text x={plotX(0)} y={PLOT.height - 30} textAnchor="middle" className="outlet-tick">
            Even
          </text>
          <text x={PLOT.left} y={PLOT.height - 14} textAnchor="start" className="outlet-axis-end">
            ← Shared more by Democrats
          </text>
          <text x={PLOT.width - PLOT.right} y={PLOT.height - 14} textAnchor="end" className="outlet-axis-end">
            Shared more by Republicans →
          </text>
          <text
            x={10}
            y={(PLOT.top + PLOT.height - PLOT.bottom) / 2}
            textAnchor="middle"
            className="outlet-axis-title"
            transform={`rotate(-90 10 ${(PLOT.top + PLOT.height - PLOT.bottom) / 2})`}
          >
            Rated quality
          </text>
          {placed.filter((point) => !point.current).map((point) => (
            <OutletMarker key={point.host} point={point} />
          ))}
          {placed.filter((point) => point.current).map((point) => (
            <OutletMarker key={point.host} point={point} />
          ))}
          {placed.map((point) => (
            <circle
              key={`hit-${point.host}`}
              cx={point.x}
              cy={point.y}
              r={9}
              className="outlet-hit"
              tabIndex={0}
              aria-label={`${point.name}: rated quality ${Math.round(point.quality)} of 100, ${partisanshipLabel(point.partisanship).toLowerCase()}.`}
              onMouseEnter={() => setHovered(point)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(point)}
              onBlur={() => setHovered(null)}
            />
          ))}
        </svg>
        {hovered && (
          <div
            className="outlet-tooltip"
            style={{
              left: `${(hovered.x / PLOT.width) * 100}%`,
              top: `${(hovered.y / PLOT.height) * 100}%`
            }}
          >
            <strong>
              {hovered.name}
              {hovered.current ? " (this outlet)" : ""}
            </strong>
            <span>
              {qualityLabel(hovered.quality)} · {partisanshipLabel(hovered.partisanship)}
            </span>
          </div>
        )}
      </div>
      <details className="minor-disclosure">
        <summary>View placements as a table</summary>
        <table className="outlet-table">
          <thead>
            <tr>
              <th scope="col">Outlet</th>
              <th scope="col">Rated quality</th>
              <th scope="col">Audience</th>
            </tr>
          </thead>
          <tbody>
            {[...points]
              .sort((a, b) => b.quality - a.quality)
              .map((point) => (
                <tr key={point.host} className={point.current ? "is-current" : undefined}>
                  <th scope="row">
                    {point.name}
                    {point.current ? " (this outlet)" : ""}
                  </th>
                  <td>{Math.round(point.quality)} / 100</td>
                  <td>{partisanshipLabel(point.partisanship)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

export function OutletProfileCard({ analysis }: { analysis: Analysis }) {
  const profile = analysis.outletProfile;
  if (!profile) return null;
  const placement = profile.placement;
  const facts: Array<[string, string]> = [
    ["Based in", profile.headquarters],
    ["Ownership", profile.ownership],
    ["Funding", profile.funding],
    ["Founded", profile.founded],
    ["Medium", profile.medium]
  ];
  return (
    <section className="prototype-section outlet-profile">
      <div className="prototype-heading-row">
        <span className="prototype-label">Outlet profile</span>
        <span>{profile.origin === "ai-research" ? "AI web research" : "Research datasets"}</span>
      </div>
      <p className="outlet-name">{profile.name}</p>
      <dl className="outlet-facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {placement ? (
        <>
          <p className="outlet-placement-headline">
            {qualityLabel(placement.quality)} · {partisanshipLabel(placement.partisanship)}
          </p>
          <OutletPlacementChart profile={profile} />
          <p className="coverage-note">{placement.note}</p>
          <div className="outlet-citations">
            <span className="outlet-citations-label">Placement data ({OUTLET_DATA_GENERATED_AT}):</span>
            {OUTLET_DATA_SOURCES.map((source) => (
              <a key={source.url} href={source.url} target="_blank" rel="noreferrer" title={source.citation}>
                <LinkSimple size={12} />
                {source.label}
              </a>
            ))}
          </div>
        </>
      ) : (
        <p className="coverage-note">
          This outlet is not in the research datasets Ellipsis uses for placement, so it is not charted.{" "}
          {OUTLET_PLACEMENT_DISCLAIMER}
        </p>
      )}
      {profile.origin === "ai-research" && profile.citations.length > 0 && (
        <div className="outlet-citations">
          <span className="outlet-citations-label">Outlet facts researched from:</span>
          {profile.citations.map((citation) => (
            <a key={citation.url} href={citation.url} target="_blank" rel="noreferrer">
              <LinkSimple size={12} />
              {citation.label}
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
