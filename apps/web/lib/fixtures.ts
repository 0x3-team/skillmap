import attentionSnapshotJson from "@/data/fixtures/dashboard-snapshot.attention-required.json";
import releaseSnapshotJson from "@/data/fixtures/dashboard-snapshot.release-ready.json";
import connectorBlockedJson from "@/data/fixtures/connector-status.blocked.json";
import connectorOfflineJson from "@/data/fixtures/connector-status.offline.json";
import policyReviewsJson from "@/data/fixtures/policy-review.sample.json";
import routeTracesJson from "@/data/fixtures/route-traces.sample.json";
import type {
  ConnectorStatus,
  DashboardSnapshotV1,
  PolicyReviewRow,
  RouteTraceRecord,
  SnapshotMode,
  SourceRow
} from "@/lib/contracts/skillmap-dashboard";

const sourceRows: SourceRow[] = [
  {
    id: "source-anthropic-skills",
    name: "anthropic/skills",
    source: "github.com/anthropics/skills",
    state: "clean",
    lastCheckedAt: "2026-07-09T08:30:00.000Z",
    reviewStatus: "reviewed",
    nextAction: "No action"
  },
  {
    id: "source-personal-local",
    name: "personal-local",
    source: "$HOME/.codex/skills",
    state: "local",
    lastCheckedAt: "2026-07-09T08:35:00.000Z",
    reviewStatus: "reviewed",
    nextAction: "Keep local-only"
  },
  {
    id: "source-unknown-pack",
    name: "external-pack",
    source: "unknown external archive",
    state: "unknown",
    lastCheckedAt: "2026-07-07T12:10:00.000Z",
    reviewStatus: "needs-review",
    nextAction: "Adopt source or hold from routing"
  },
  {
    id: "source-risky-update",
    name: "shader-background",
    source: "third-party visual pack",
    state: "risky",
    lastCheckedAt: "2026-07-09T07:50:00.000Z",
    reviewStatus: "held",
    nextAction: "Inspect scripts before enabling"
  }
];

export const routeTraces = routeTracesJson as RouteTraceRecord[];
export const policyReviews = policyReviewsJson as PolicyReviewRow[];
export const connectorOffline = connectorOfflineJson as ConnectorStatus;
export const connectorBlocked = connectorBlockedJson as ConnectorStatus;

export function getFixtureDashboardSnapshot(mode: SnapshotMode): DashboardSnapshotV1 {
  const base =
    mode === "release-ready"
      ? (releaseSnapshotJson as DashboardSnapshotV1)
      : (attentionSnapshotJson as DashboardSnapshotV1);

  return {
    ...base,
    recentRouteTraces: routeTraces,
    policyReviews,
    sources: sourceRows,
    connector:
      mode === "release-ready"
        ? base.connector
        : {
            ...base.connector,
            ...connectorBlocked
          },
    skills:
      base.skills.length > 0
        ? base.skills
        : (releaseSnapshotJson as DashboardSnapshotV1).skills.map((skill) =>
            skill.id === "shader-background"
              ? {
                  ...skill,
                  sourceState: "risky",
                  reviewStatus: "needs-review",
                  routeEligible: false
                }
              : skill
          )
  };
}

export const getDashboardSnapshot = getFixtureDashboardSnapshot;

export function getFixtureDashboardSnapshots(): Record<SnapshotMode, DashboardSnapshotV1> {
  return {
    "release-ready": getFixtureDashboardSnapshot("release-ready"),
    "attention-required": getFixtureDashboardSnapshot("attention-required")
  };
}

export function percent(value?: number) {
  if (value === undefined) return "n/a";
  return `${Math.round(value * 100)}%`;
}

export function compactNumber(value?: number) {
  if (value === undefined) return "n/a";
  return new Intl.NumberFormat("en", {
    notation: value > 9999 ? "compact" : "standard",
    maximumFractionDigits: 1
  }).format(value);
}
