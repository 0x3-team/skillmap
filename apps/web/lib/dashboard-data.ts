import { readFile } from "node:fs/promises";
import type {
  ConnectorState,
  DashboardPageData,
  DashboardSnapshot,
  DashboardSnapshotV1,
  DashboardSnapshotV2,
  DashboardSourceInfo,
  SnapshotMode
} from "@/lib/contracts/skillmap-dashboard";
import {
  computeTransportDigest,
  validateDashboardSnapshotV2,
  verifyPayloadDigest
} from "@/lib/canonical-payload.js";
import { getFixtureDashboardSnapshots } from "@/lib/fixtures";

const SNAPSHOT_STALE_AFTER_MS = 48 * 60 * 60 * 1000;
const SNAPSHOT_EXPORT_COMMAND =
  "skillmap export --dashboard-snapshot --redact-paths --output $PROJECT/.skillmap/dashboard-snapshot.json";
const SNAPSHOT_LOAD_COMMAND =
  "SKILLMAP_DASHBOARD_SNAPSHOT=$PROJECT/.skillmap/dashboard-snapshot.json npm run dev";
const ROUTE_TRACE_COMMAND = 'skillmap route "$PROMPT" --trace --json';
const PRIVATE_PATH_PATTERNS = [
  /\/home\//i,
  /\/Users\//i,
  /C:\\Users\\/i,
  /\/private\/var\//i,
  /\/var\/folders\//i
];
const RAW_TEXT_KEYS = /^(rawPrompt|prompt|promptText|rawSkillBody|skillBodyText)$/i;
const SECRET_PATTERNS = [
  /CANARY_/i,
  /\bsk_(?:live|test|proj)_[A-Za-z0-9_-]{8,}\b/,
  /\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{8,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/i
];

export async function loadDashboardPageData(): Promise<DashboardPageData> {
  const fixtures = buildFixtureSnapshots();
  const configuredPath = process.env.SKILLMAP_DASHBOARD_SNAPSHOT?.trim();
  const loadedAt = new Date().toISOString();
  const commands = {
    exportSnapshot: SNAPSHOT_EXPORT_COMMAND,
    loadSnapshot: SNAPSHOT_LOAD_COMMAND,
    routeTrace: ROUTE_TRACE_COMMAND
  };

  if (!configuredPath) {
    return {
      initialView: "attention-required",
      fixtures,
      fixtureSources: buildFixtureSources(fixtures, loadedAt, false),
      snapshotLoadError: {
        type: "local-snapshot",
        label: "No local snapshot configured",
        configured: false,
        loaded: false,
        loadedAt,
        integrity: "not-applicable",
        redacted: false,
        readOnly: true,
        stale: false,
        message:
          "Fixture mode is active. Set SKILLMAP_DASHBOARD_SNAPSHOT to a redacted dashboard snapshot for local state.",
        warnings: []
      },
      commands
    };
  }

  const localResult = await readLocalSnapshot(configuredPath, loadedAt);
  if (!localResult.snapshot) {
    const fallbackFixtures =
      localResult.source.error === "integrity-failed" ||
      localResult.source.error === "validation-failed" ||
      localResult.source.error === "malformed-json"
        ? blockFixtureFallback(fixtures)
        : fixtures;
    return {
      initialView: "attention-required",
      fixtures: fallbackFixtures,
      fixtureSources: buildFixtureSources(fallbackFixtures, loadedAt, false),
      snapshotLoadError: localResult.source,
      commands
    };
  }

  return {
    initialView: "local-snapshot",
    fixtures,
    fixtureSources: buildFixtureSources(fixtures, loadedAt, true),
    localSnapshot: localResult.snapshot,
    localSource: localResult.source,
    commands
  };
}

function blockFixtureFallback(
  fixtures: Record<SnapshotMode, DashboardSnapshot>
): Record<SnapshotMode, DashboardSnapshot> {
  return {
    "release-ready": withConnectorForSource(fixtures["release-ready"], {
      state: "blocked",
      message:
        "Local snapshot integrity verification failed. Fixture demo fallback is visible, but its connector is blocked and it is not local evidence."
    }),
    "attention-required": withConnectorForSource(fixtures["attention-required"], {
      state: "blocked",
      message:
        "Local snapshot integrity verification failed. Fixture demo fallback is visible, but its connector is blocked and it is not local evidence."
    })
  };
}

function buildFixtureSnapshots(): Record<SnapshotMode, DashboardSnapshot> {
  const fixtures = getFixtureDashboardSnapshots();
  return {
    "release-ready": withConnectorForSource(fixtures["release-ready"], {
      state: "offline",
      message:
        "Fixture demo is active. Fixture data is never treated as verified local SkillMap readiness."
    }),
    "attention-required": withConnectorForSource(fixtures["attention-required"], {
      state: "offline",
      message:
        "Fixture demo is active. This illustrative state is excluded from trusted local snapshot handling."
    })
  };
}

function buildFixtureSources(
  fixtures: Record<SnapshotMode, DashboardSnapshot>,
  loadedAt: string,
  hasLocalSnapshot: boolean
): Record<SnapshotMode, DashboardSourceInfo> {
  return {
    "release-ready": {
      type: "fixture",
      label: "Fixture demo",
      configured: false,
      loaded: true,
      generatedAt: fixtures["release-ready"].generatedAt,
      loadedAt,
      integrity: "not-applicable",
      redacted: fixtures["release-ready"].redacted,
      readOnly: true,
      stale: false,
      message: hasLocalSnapshot
        ? "Viewing fixture release-ready sample instead of the loaded local snapshot."
        : "Viewing fixture release-ready sample. This is not verified local readiness.",
      warnings: hasLocalSnapshot ? [] : ["No local snapshot is configured for this view."]
    },
    "attention-required": {
      type: "fixture",
      label: "Fixture demo",
      configured: false,
      loaded: true,
      generatedAt: fixtures["attention-required"].generatedAt,
      loadedAt,
      integrity: "not-applicable",
      redacted: fixtures["attention-required"].redacted,
      readOnly: true,
      stale: false,
      message: hasLocalSnapshot
        ? "Viewing fixture attention-required sample instead of the loaded local snapshot."
        : "Viewing fixture attention-required sample. This is not verified local readiness.",
      warnings: hasLocalSnapshot ? [] : ["No local snapshot is configured for this view."]
    }
  };
}

async function readLocalSnapshot(
  snapshotPath: string,
  loadedAt: string
): Promise<{ snapshot?: DashboardSnapshot; source: DashboardSourceInfo }> {
  let raw = "";
  try {
    raw = await readFile(snapshotPath, "utf8");
  } catch (error) {
    const code = getErrorCode(error);
    const permissionError = code === "EACCES" || code === "EPERM";
    return {
      source: {
        type: "local-snapshot",
        label: permissionError ? "Local snapshot permission error" : "Local snapshot unavailable",
        configured: true,
        loaded: false,
        loadedAt,
        integrity: "failed",
        redacted: false,
        readOnly: true,
        stale: true,
        message: permissionError
          ? "The configured snapshot exists behind a filesystem permission boundary."
          : "The configured snapshot could not be read. Fixture mode is active instead.",
        warnings: ["Local snapshot was not loaded."],
        error: permissionError ? "permission-denied" : "read-failed"
      }
    };
  }

  let parsed: unknown;
  const transportDigest = computeTransportDigest(raw);
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      source: {
        type: "local-snapshot",
        label: "Malformed local snapshot",
        configured: true,
        loaded: false,
        loadedAt,
        integrity: "failed",
        transportDigest,
        snapshotHash: transportDigest,
        redacted: false,
        readOnly: true,
        stale: true,
        message: "The configured snapshot is not valid JSON. Fixture mode is active instead.",
        warnings: ["Local snapshot failed JSON parsing."],
        error: "malformed-json"
      }
    };
  }

  if (isRecord(parsed) && parsed.version === 1) {
    return readLegacySnapshot(parsed, loadedAt, transportDigest);
  }

  const contract = validateDashboardSnapshotV2(parsed);
  const digest = verifyPayloadDigest(parsed);
  if (!contract.ok || !digest.ok) {
    const warnings = [
      ...contract.issues,
      ...(digest.error ? [digest.error] : [])
    ];
    return {
      source: {
        type: "local-snapshot",
        label: "Local snapshot integrity failure",
        configured: true,
        loaded: false,
        loadedAt,
        integrity: "failed",
        transportDigest,
        snapshotHash: transportDigest,
        redacted: false,
        readOnly: true,
        stale: true,
        message:
          "The configured v2 snapshot failed strict schema or payloadDigest verification. It was not used; fixture demo mode is active instead.",
        warnings: warnings.length > 0 ? warnings : ["Snapshot integrity validation failed."],
        error: "integrity-failed"
      }
    };
  }

  try {
    assertRedactedSnapshot(parsed);
  } catch (error) {
    return {
      source: {
        type: "local-snapshot",
        label: "Unsafe local snapshot",
        configured: true,
        loaded: false,
        loadedAt,
        integrity: "failed",
        payloadDigest: digest.actual,
        transportDigest,
        snapshotHash: transportDigest,
        redacted: false,
        readOnly: true,
        stale: true,
        message:
          "The configured v2 snapshot passed its digest check but failed the privacy gate. It was not used; fixture demo mode is active instead.",
        warnings: [error instanceof Error ? error.message : "Snapshot privacy validation failed."],
        error: "validation-failed"
      }
    };
  }

  const snapshot = parsed as DashboardSnapshotV2;
  const staleInfo = getStaleInfo(snapshot.generatedAt, loadedAt);
  const source: DashboardSourceInfo = {
    type: "local-snapshot",
    label: "Local snapshot",
    configured: true,
    loaded: true,
    generatedAt: snapshot.generatedAt,
    loadedAt,
    integrity: "verified",
    payloadDigest: snapshot.payloadDigest,
    transportDigest,
    snapshotHash: transportDigest,
    redacted: snapshot.redacted,
    readOnly: true,
    stale: staleInfo.stale,
    message: staleInfo.stale
      ? "A redacted local snapshot was loaded, but it is stale or has invalid time metadata."
      : "A redacted local snapshot was loaded from SKILLMAP_DASHBOARD_SNAPSHOT in read-only mode.",
    warnings: staleInfo.warning ? [staleInfo.warning] : []
  };

  return {
    source,
    snapshot: withConnectorForSource(snapshot, {
      state: connectorStateForLocal(snapshot, source),
      hash: transportDigest,
      message: connectorMessageForLocal(snapshot, source),
      loadedAt
    })
  };
}

function readLegacySnapshot(
  parsed: Record<string, unknown>,
  loadedAt: string,
  transportDigest: string
): { snapshot?: DashboardSnapshot; source: DashboardSourceInfo } {
  try {
    assertDashboardSnapshotV1(parsed);
    assertRedactedSnapshot(parsed);
  } catch (error) {
    return {
      source: {
        type: "local-snapshot",
        label: "Invalid legacy local snapshot",
        configured: true,
        loaded: false,
        loadedAt,
        integrity: "failed",
        transportDigest,
        snapshotHash: transportDigest,
        redacted: false,
        readOnly: true,
        stale: true,
        message:
          "The configured legacy snapshot failed its compatibility or privacy check. It was not used; fixture demo mode is active instead.",
        warnings: [error instanceof Error ? error.message : "Legacy snapshot validation failed."],
        error: "validation-failed"
      }
    };
  }

  const snapshot = parsed;
  const source: DashboardSourceInfo = {
    type: "local-snapshot",
    label: "Legacy local snapshot (unverified)",
    configured: true,
    loaded: true,
    generatedAt: snapshot.generatedAt,
    loadedAt,
    integrity: "legacy-unverified",
    transportDigest,
    snapshotHash: transportDigest,
    redacted: snapshot.redacted,
    readOnly: true,
    stale: true,
    message:
      "A legacy v1 snapshot was loaded for compatibility only. It has no verifiable payloadDigest and cannot be treated as fresh or ready.",
    warnings: [
      "Legacy v1 snapshots are unverified. Export a fresh v2 redacted dashboard snapshot."
    ],
    error: "legacy-unverified"
  };

  return {
    source,
    snapshot: withConnectorForSource(snapshot, {
      state: "blocked",
      message:
        "Legacy v1 snapshot loaded for compatibility only. Connector remains blocked until a verified v2 snapshot is exported.",
      loadedAt
    })
  };
}

function connectorStateForLocal(
  snapshot: DashboardSnapshot,
  source: DashboardSourceInfo
): ConnectorState {
  if (source.error === "permission-denied") return "unauthorized";
  if (source.integrity !== "verified") return "blocked";
  if (source.stale) return "blocked";
  if (snapshot.status.verdict !== "ok") return "blocked";
  return "offline";
}

function connectorMessageForLocal(snapshot: DashboardSnapshot, source: DashboardSourceInfo) {
  if (source.integrity !== "verified") {
    return "Local snapshot integrity is not verified. Connector remains blocked until a valid v2 snapshot is exported.";
  }
  if (source.stale) {
    return "Local snapshot is loaded but stale. Export a fresh redacted snapshot before treating it as current.";
  }
  if (snapshot.status.verdict !== "ok") {
    return "Local snapshot loaded, but SkillMap status is not ready. Connector remains blocked.";
  }
  return "Verified local snapshot loaded in read-only mode. There is no live connector session; dashboard actions copy CLI commands only.";
}

function withConnectorForSource(
  snapshot: DashboardSnapshot,
  options: { state: ConnectorState; hash?: string; message: string; loadedAt?: string }
): DashboardSnapshot {
  const allowedCommands = [
    ...snapshot.connector.allowedCommands,
    SNAPSHOT_EXPORT_COMMAND,
    SNAPSHOT_LOAD_COMMAND,
    ROUTE_TRACE_COMMAND
  ];
  return {
    ...snapshot,
    connector: {
      ...snapshot.connector,
      state: options.state,
      lastSeenAt: options.loadedAt ?? snapshot.connector.lastSeenAt,
      lastSnapshotHash: options.hash,
      redactionEnabled: snapshot.redacted,
      readOnlyMode: true,
      allowedCommands: [...new Set(allowedCommands)].map(redactCommand),
      nextCommand: snapshot.connector.nextCommand
        ? redactCommand(snapshot.connector.nextCommand)
        : SNAPSHOT_EXPORT_COMMAND,
      message: options.message
    }
  };
}

function assertDashboardSnapshotV1(value: unknown): asserts value is DashboardSnapshotV1 {
  if (!value || typeof value !== "object") {
    throw new Error("Snapshot root must be an object.");
  }
  const snapshot = value as Partial<DashboardSnapshotV1>;
  if (snapshot.version !== 1) throw new Error("Snapshot version must be 1.");
  if (snapshot.redacted !== true) throw new Error("Snapshot must set redacted: true.");
  if (snapshot.mode !== "release-ready" && snapshot.mode !== "attention-required") {
    throw new Error("Snapshot mode is unsupported.");
  }
  if (!snapshot.status || typeof snapshot.status !== "object") {
    throw new Error("Snapshot status is missing.");
  }
  if (!snapshot.connector || typeof snapshot.connector !== "object") {
    throw new Error("Snapshot connector is missing.");
  }
  for (const key of ["skills", "recentRouteTraces", "policyReviews", "sources"] as const) {
    if (!Array.isArray(snapshot[key])) {
      throw new Error(`Snapshot ${key} must be an array.`);
    }
  }
}

function assertRedactedSnapshot(value: unknown, path = "$") {
  if (typeof value === "string") {
    for (const pattern of PRIVATE_PATH_PATTERNS) {
      if (pattern.test(value)) {
        throw new Error(`Snapshot contains an unredacted local path at ${path}.`);
      }
    }
    if (containsAbsolutePath(value)) {
      throw new Error(`Snapshot contains an absolute local path at ${path}.`);
    }
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(value)) throw new Error(`Snapshot contains a secret or privacy canary at ${path}.`);
    }
    if (/promptPreview$/i.test(path.split(".").pop() ?? "") && value.length > 96) {
      throw new Error(`Snapshot prompt preview is too long at ${path}.`);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertRedactedSnapshot(entry, `${path}[${index}]`));
    return;
  }

  if (!value || typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  if ("rawPromptStored" in record) {
    if (record.rawPromptStored !== false) {
      throw new Error(`Route trace must set rawPromptStored: false at ${path}.`);
    }
  }
  if ("redacted" in record && record.redacted !== true) {
    throw new Error(`Snapshot redacted flag must remain true at ${path}.`);
  }

  for (const [key, child] of Object.entries(record)) {
    if (RAW_TEXT_KEYS.test(key)) {
      throw new Error(`Snapshot contains forbidden raw text field ${key} at ${path}.`);
    }
    assertRedactedSnapshot(child, `${path}.${key}`);
  }
}

function containsAbsolutePath(value: string) {
  return /(^|[\s("'=:])\/(?!\/)[^\s"'<>),;]+/.test(value)
    || /(^|[\s("'=:])[A-Za-z]:\\[^\s"'<>),;]+/.test(value)
    || /(^|[\s("'=:])\\\\[^\s"'<>),;]+/.test(value)
    || /\bfile:\/\//i.test(value);
}

function getStaleInfo(generatedAt: string, loadedAt: string) {
  const generatedMs = Date.parse(generatedAt);
  const loadedMs = Date.parse(loadedAt);
  if (!Number.isFinite(generatedMs)) {
    return { stale: true, warning: "Snapshot generatedAt is not a valid timestamp." };
  }
  if (loadedMs - generatedMs > SNAPSHOT_STALE_AFTER_MS) {
    return { stale: true, warning: "Snapshot is older than 48 hours." };
  }
  if (generatedMs - loadedMs > 5 * 60 * 1000) {
    return {
      stale: true,
      warning: "Snapshot generatedAt is ahead of the dashboard server clock."
    };
  }
  return { stale: false };
}

function redactCommand(command: string) {
  return command
    .replace(/\/home\/[^\s"']+/gi, "$HOME")
    .replace(/\/Users\/[^\s"']+/gi, "$HOME")
    .replace(/C:\\Users\\[^\s"']+/gi, "$HOME")
    .replace(/\/private\/var\/[^\s"']+/gi, "$TMP")
    .replace(/\/var\/folders\/[^\s"']+/gi, "$TMP");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getErrorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}
