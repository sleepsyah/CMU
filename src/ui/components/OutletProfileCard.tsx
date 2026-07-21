import { useMemo, useState } from "react";
import { LinkSimple } from "@phosphor-icons/react";
import type { Analysis, OutletProfile, OutletReferencePoint } from "../../types";
import { affiliationLabel, factualityLabel, OUTLET_PLACEMENT_DISCLAIMER, referenceOutlets } from "../../lib/outlet";

const PLOT = { width: 340, height: 250, left: 34, right: 12, top: 16, bottom: 36 };

interface PlottedOutlet extends OutletReferencePoint {
  current?: boolean;
}

function plotX(affiliation: number) {
  const span = PLOT.width - PLOT.left - PLOT.right;
  return PLOT.left + ((affiliation + 100) / 200) * span;
}

function plotY(factuality: number) {
  const span = PLOT.height - PLOT.top - PLOT.bottom;
  return PLOT.top + (1 - factuality / 100) * span;
}

function OutletPlacementChart({ profile }: { profile: OutletProfile }) {
  const placement = profile.placement;
  const [hovered, setHovered] = useState<PlottedOutlet | null>(null);
  const points = useMemo<PlottedOutlet[]>(() => {
    const references = referenceOutlets(profile.host);
    if (!placement) return references;
    return [...references, { name: profile.name, host: profile.host, factuality: placement.factuality, affiliation: placement.affiliation, current: true }];
  }, [profile, placement]);
  if (!placement) return null;

  const current = points.find((point) => point.current);
  const gridY = [0, 25, 50, 75, 100];
  const labelAbove = placement.factuality < 88;
  const labelAnchor = placement.affiliation > 55 ? "end" : placement.affiliation < -55 ? "start" : "middle";

  return (
    <div className="outlet-chart">
      <div className="outlet-chart-legend" aria-hidden="true">
        <span><i className="outlet-swatch is-current" />This outlet</span>
        <span><i className="outlet-swatch" />Reference outlets</span>
      </div>
      <div className="outlet-chart-frame">
        <svg
          viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
          role="img"
          aria-label={`Chart placing ${profile.name} at factual-record ${Math.round(placement.factuality)} of 100 and affiliation ${affiliationLabel(placement.affiliation).toLowerCase()} among ${points.length - 1} reference outlets.`}
        >
          {gridY.map((value) => (
            <line key={value} x1={PLOT.left} x2={PLOT.width - PLOT.right} y1={plotY(value)} y2={plotY(value)} className="outlet-grid" />
          ))}
          <line x1={plotX(0)} x2={plotX(0)} y1={PLOT.top} y2={PLOT.height - PLOT.bottom} className="outlet-grid is-mid" />
          {gridY.map((value) => (
            <text key={value} x={PLOT.left - 6} y={plotY(value) + 3} textAnchor="end" className="outlet-tick">{value}</text>
          ))}
          <text x={PLOT.left} y={PLOT.height - 10} textAnchor="start" className="outlet-tick">Left</text>
          <text x={plotX(0)} y={PLOT.height - 10} textAnchor="middle" className="outlet-tick">Center</text>
          <text x={PLOT.width - PLOT.right} y={PLOT.height - 10} textAnchor="end" className="outlet-tick">Right</text>
          <text
            x={10}
            y={(PLOT.top + PLOT.height - PLOT.bottom) / 2}
            textAnchor="middle"
            className="outlet-axis-title"
            transform={`rotate(-90 10 ${(PLOT.top + PLOT.height - PLOT.bottom) / 2})`}
          >
            Factual record
          </text>
          {points.filter((point) => !point.current).map((point) => (
            <circle key={point.host} cx={plotX(point.affiliation)} cy={plotY(point.factuality)} r={4} className="outlet-dot" />
          ))}
          {current && (
            <g>
              <circle cx={plotX(current.affiliation)} cy={plotY(current.factuality)} r={6.5} className="outlet-dot is-current" />
              <text
                x={plotX(current.affiliation)}
                y={plotY(current.factuality) + (labelAbove ? -11 : 17)}
                textAnchor={labelAnchor}
                className="outlet-dot-label"
              >
                {current.name}
              </text>
            </g>
          )}
          {points.map((point) => (
            <circle
              key={`hit-${point.host}`}
              cx={plotX(point.affiliation)}
              cy={plotY(point.factuality)}
              r={10}
              className="outlet-hit"
              tabIndex={0}
              aria-label={`${point.name}: factual record ${Math.round(point.factuality)} of 100, ${affiliationLabel(point.affiliation).toLowerCase()}.`}
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
              left: `${(plotX(hovered.affiliation) / PLOT.width) * 100}%`,
              top: `${(plotY(hovered.factuality) / PLOT.height) * 100}%`
            }}
          >
            <strong>{hovered.name}</strong>
            <span>{factualityLabel(hovered.factuality)} · {affiliationLabel(hovered.affiliation)}</span>
          </div>
        )}
      </div>
      <details className="minor-disclosure">
        <summary>View placements as a table</summary>
        <table className="outlet-table">
          <thead><tr><th scope="col">Outlet</th><th scope="col">Factual record</th><th scope="col">Affiliation</th></tr></thead>
          <tbody>
            {[...points].sort((a, b) => b.factuality - a.factuality).map((point) => (
              <tr key={point.host} className={point.current ? "is-current" : undefined}>
                <th scope="row">{point.name}{point.current ? " (this outlet)" : ""}</th>
                <td>{Math.round(point.factuality)} / 100</td>
                <td>{affiliationLabel(point.affiliation)}</td>
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
        <span>{profile.origin === "ai-research" ? "AI web research" : "Bundled reference data"}</span>
      </div>
      <p className="outlet-name">{profile.name}</p>
      <dl className="outlet-facts">
        {facts.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
      {placement && (
        <>
          <p className="outlet-placement-headline">{factualityLabel(placement.factuality)} · {affiliationLabel(placement.affiliation)}</p>
          <OutletPlacementChart profile={profile} />
          <p className="coverage-note">{placement.note === OUTLET_PLACEMENT_DISCLAIMER ? placement.note : `${placement.note} ${OUTLET_PLACEMENT_DISCLAIMER}`}</p>
        </>
      )}
      {profile.citations.length > 0 && (
        <div className="outlet-citations">
          {profile.citations.map((citation) => (
            <a key={citation.url} href={citation.url} target="_blank" rel="noreferrer"><LinkSimple size={12} />{citation.label}</a>
          ))}
        </div>
      )}
    </section>
  );
}
