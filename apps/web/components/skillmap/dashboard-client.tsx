"use client";

import {
  AlertTriangle,
  Braces,
  CheckCircle2,
  ClipboardCopy,
  Command,
  Database,
  FileSearch,
  Gauge,
  GitPullRequest,
  Layers3,
  Menu,
  PlugZap,
  Route,
  Search,
  ShieldCheck,
  Table2,
  TerminalSquare,
  Zap
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { AnimatedBadge } from "@/components/ui/animated-badge";
import {
  AnimatedToastStack,
  type ToastStatus,
  useAnimatedToastStack
} from "@/components/ui/animated-toast-stack";
import { Button, StatefulButton, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CommandPalette, type CommandItem } from "@/components/ui/command-palette";
import { Drawer } from "@/components/ui/drawer";
import { AnimatedNumber } from "@/components/ui/number";
import { Select } from "@/components/ui/select";
import { DataTable, type TableColumn } from "@/components/ui/table";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import type {
  ConnectorState,
  DashboardCommandSet,
  DashboardPageData,
  DashboardSnapshot,
  DashboardSourceInfo,
  DashboardView,
  PolicyReviewRow,
  RouteTraceRecord,
  SkillTableRow,
  SnapshotMode,
  SourceRow,
  SourceState
} from "@/lib/contracts/skillmap-dashboard";
import { compactNumber, percent } from "@/lib/fixtures";
import { cn } from "@/lib/utils";

type DashboardTab =
  | "overview"
  | "route"
  | "skills"
  | "policies"
  | "trust"
  | "sources"
  | "connector"
  | "qa";

type ToastInput = { status: ToastStatus; title: string; description?: string };
type CopyActionInput = {
  id: string;
  text: string;
  successTitle: string;
  successDescription?: string;
  errorTitle?: string;
};
type CopyActions = {
  states: Record<string, ButtonState>;
  copy: (input: CopyActionInput) => Promise<void>;
};

const navItems: Array<{ id: DashboardTab; label: string; icon: JSX.Element }> = [
  { id: "overview", label: "Overview", icon: <Gauge /> },
  { id: "route", label: "Route Lab", icon: <Route /> },
  { id: "skills", label: "Skills", icon: <Table2 /> },
  { id: "policies", label: "Policies", icon: <Layers3 /> },
  { id: "trust", label: "Trust", icon: <ShieldCheck /> },
  { id: "sources", label: "Sources", icon: <Database /> },
  { id: "connector", label: "Connector", icon: <PlugZap /> },
  { id: "qa", label: "QA", icon: <FileSearch /> }
];

const tabItems: TabItem[] = navItems.map((item) => ({
  id: item.id,
  label: item.label
}));

export function DashboardClient({ data }: { data: DashboardPageData }) {
  const [view, setView] = useState<DashboardView>(data.initialView);
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");
  const [commandOpen, setCommandOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<SkillTableRow | null>(null);
  const [routePrompt, setRoutePrompt] = useState(() => initialRoutePrompt(data));
  const [copyStates, setCopyStates] = useState<Record<string, ButtonState>>({});
  const { toasts, showToast, dismissToast } = useAnimatedToastStack();
  const localAvailable = Boolean(data.localSnapshot && data.localSource);
  const activeView: DashboardView = view === "local-snapshot" && !localAvailable ? "release-ready" : view;
  const snapshot =
    activeView === "local-snapshot" && data.localSnapshot
      ? data.localSnapshot
      : data.fixtures[activeView as SnapshotMode];
  const sourceInfo =
    activeView === "local-snapshot" && data.localSource
      ? data.localSource
      : data.fixtureSources[activeView as SnapshotMode];
  const primaryTrace = useMemo(
    () => selectRecordedTrace(snapshot.recentRouteTraces, routePrompt),
    [routePrompt, snapshot.recentRouteTraces]
  );

  useEffect(() => {
    const requested = window.location.hash.slice(1);
    const requestedTab = navItems.some((item) => item.id === requested)
      ? (requested as DashboardTab)
      : requested === "route-demo"
        ? "route"
        : undefined;
    if (!requestedTab) return;
    const frame = window.requestAnimationFrame(() => {
      setActiveTab(requestedTab);
      window.requestAnimationFrame(() => {
        document
          .getElementById(`dashboard-panel-${requestedTab}`)
          ?.focus({ preventScroll: true });
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const copyToClipboard = useCallback(
    async ({
      id,
      text,
      successTitle,
      successDescription,
      errorTitle = "Copy failed"
    }: CopyActionInput) => {
      setCopyStates((current) => ({ ...current, [id]: "loading" }));
      try {
        if (!text.trim()) {
          throw new Error("Nothing to copy.");
        }
        if (!navigator.clipboard?.writeText) {
          throw new Error("Clipboard API is unavailable in this browser context.");
        }
        await navigator.clipboard.writeText(text);
        setCopyStates((current) => ({ ...current, [id]: "success" }));
        showToast({
          status: "success",
          title: successTitle,
          description: successDescription ?? "Copied to clipboard. No local command was executed."
        });
        window.setTimeout(
          () => setCopyStates((current) => ({ ...current, [id]: "idle" })),
          1600
        );
      } catch (error) {
        setCopyStates((current) => ({ ...current, [id]: "error" }));
        showToast({
          status: "error",
          title: errorTitle,
          description: error instanceof Error ? error.message : "Clipboard write failed."
        });
        window.setTimeout(
          () => setCopyStates((current) => ({ ...current, [id]: "idle" })),
          2200
        );
      }
    },
    [showToast]
  );
  const copyActions = useMemo<CopyActions>(
    () => ({ states: copyStates, copy: copyToClipboard }),
    [copyStates, copyToClipboard]
  );

  const commandItems: CommandItem[] = useMemo(
    () => [
      ...navItems.map((item) => ({
        id: `go-${item.id}`,
        label: `Go to ${item.label}`,
        group: "Navigation",
        icon: Search,
        onSelect: () => setActiveTab(item.id)
      })),
      {
        id: "copy-route",
        label: "Copy current hook text",
        group: "Route Lab",
        icon: ClipboardCopy,
        onSelect: () =>
          void copyToClipboard({
            id: "palette-copy-route",
            text: primaryTrace?.hookText ?? "",
            successTitle: "Route hint copied",
            successDescription: "Copied hook text only. No hook was installed."
          })
      },
      {
        id: "copy-snapshot-export",
        label: "Copy snapshot export command",
        group: "Local snapshot",
        icon: TerminalSquare,
        onSelect: () =>
          void copyToClipboard({
            id: "palette-copy-snapshot-export",
            text: data.commands.exportSnapshot,
            successTitle: "Snapshot export command copied",
            successDescription: "Copied a read-only dashboard handoff command; nothing was run."
          })
      },
      {
        id: "switch-attention",
        label: "Switch to fixture attention-required snapshot",
        group: "Fixture state",
        icon: AlertTriangle,
        onSelect: () => setView("attention-required")
      },
      {
        id: "switch-release",
        label: "Switch to fixture release-ready snapshot",
        group: "Fixture state",
        icon: CheckCircle2,
        onSelect: () => setView("release-ready")
      },
      ...(localAvailable
        ? [
            {
              id: "switch-local",
              label: "Switch to local snapshot",
              group: "Local snapshot",
              icon: Database,
              onSelect: () => setView("local-snapshot" as DashboardView)
            }
          ]
        : [])
    ],
    [copyToClipboard, data.commands.exportSnapshot, localAvailable, primaryTrace?.hookText]
  );

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-background text-foreground">
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} items={commandItems} />
      <AnimatedToastStack toasts={toasts} onDismiss={dismissToast} />

      <div className="grid min-h-screen lg:grid-cols-[272px_1fr]">
        <aside className="hidden border-r border-border bg-card/76 px-4 py-5 lg:block">
          <DashboardBrand />
          <SideNav activeTab={activeTab} onChange={setActiveTab} />
        </aside>

        <section className="min-w-0">
          <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-xl">
            <div className="flex min-h-16 flex-col gap-3 px-4 py-3 sm:px-6 xl:px-8">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Open navigation"
                    onClick={() => setMobileNavOpen(true)}
                    className="lg:hidden"
                  >
                    <Menu className="h-4 w-4" />
                  </Button>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {snapshot.workspaceName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {sourceInfo.label} / {snapshot.mode} / {formatUtc(snapshot.generatedAt)}
                    </p>
                  </div>
                </div>

                <div className="flex min-w-0 shrink-0 items-center gap-2">
                  <Select
                    aria-label="Workspace snapshot"
                    value={activeView}
                    onChange={(event) => setView(event.target.value as DashboardView)}
                    wrapperClassName="hidden sm:inline-flex"
                    className="w-64"
                  >
                    {localAvailable ? <option value="local-snapshot">Local snapshot</option> : null}
                    <option value="release-ready">Fixture: release-ready</option>
                    <option value="attention-required">Fixture: attention required</option>
                  </Select>
                  <Button
                    variant="secondary"
                    className="hidden sm:inline-flex"
                    icon={<Command className="h-4 w-4" />}
                    aria-expanded={commandOpen}
                    aria-haspopup="dialog"
                    onClick={() => setCommandOpen(true)}
                  >
                    Cmd-K
                  </Button>
                  <AnimatedBadge
                    status={connectorTone(snapshot.connector.state)}
                    className="max-w-[8.5rem]"
                  >
                    {snapshot.connector.state}
                  </AnimatedBadge>
                </div>
              </div>

              <div className="sm:hidden">
                <label
                  htmlFor="mobile-workspace-snapshot"
                  className="mb-1 block text-xs font-semibold text-muted-foreground"
                >
                  Snapshot source
                </label>
                <Select
                  id="mobile-workspace-snapshot"
                  value={activeView}
                  onChange={(event) => setView(event.target.value as DashboardView)}
                  wrapperClassName="w-full"
                  className="w-full"
                >
                  {localAvailable ? <option value="local-snapshot">Local snapshot</option> : null}
                  <option value="release-ready">Fixture: release-ready</option>
                  <option value="attention-required">Fixture: attention required</option>
                </Select>
              </div>

              <Tabs
                items={tabItems}
                value={activeTab}
                onChange={(value) => setActiveTab(value as DashboardTab)}
                idPrefix="dashboard"
                ariaLabel="Dashboard sections"
                className="lg:hidden"
              />
            </div>
          </header>

          <div className="px-4 py-6 sm:px-6 xl:px-8">
            <SnapshotSourceBar
              source={sourceInfo}
              loadError={data.snapshotLoadError}
              commands={data.commands}
              copyActions={copyActions}
            />
            <div
              id={`dashboard-panel-${activeTab}`}
              role="tabpanel"
              aria-labelledby={`dashboard-tab-${activeTab}`}
              tabIndex={0}
              className="min-w-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            >
              {activeTab === "overview" ? (
                <Overview
                  snapshot={snapshot}
                  sourceInfo={sourceInfo}
                  copyActions={copyActions}
                  commands={data.commands}
                />
              ) : null}
              {activeTab === "route" ? (
                <RouteLab
                  trace={primaryTrace}
                  prompt={routePrompt}
                  onPromptChange={setRoutePrompt}
                  copyActions={copyActions}
                  commands={data.commands}
                />
              ) : null}
              {activeTab === "skills" ? (
                <SkillsPanel
                  skills={snapshot.skills}
                  selectedIds={selectedSkillIds}
                  onSelectedIds={setSelectedSkillIds}
                  onOpenSkill={setSelectedSkill}
                  onToast={showToast}
                  copyActions={copyActions}
                  commands={data.commands}
                />
              ) : null}
              {activeTab === "policies" ? (
                <PolicyPanel rows={snapshot.policyReviews} copyActions={copyActions} />
              ) : null}
              {activeTab === "trust" ? <TrustPanel snapshot={snapshot} /> : null}
              {activeTab === "sources" ? (
                <SourcesPanel rows={snapshot.sources} onToast={showToast} />
              ) : null}
              {activeTab === "connector" ? (
                <ConnectorPanel
                  snapshot={snapshot}
                  sourceInfo={sourceInfo}
                  commands={data.commands}
                  copyActions={copyActions}
                />
              ) : null}
              {activeTab === "qa" ? <QaPanel snapshot={snapshot} /> : null}
            </div>
          </div>
        </section>
      </div>

      <Drawer
        open={mobileNavOpen}
        onOpenChange={setMobileNavOpen}
        title="SkillMap navigation"
        side="left"
      >
        <DashboardBrand compact />
        <SideNav
          activeTab={activeTab}
          onChange={(tab) => {
            setActiveTab(tab);
            setMobileNavOpen(false);
          }}
        />
      </Drawer>

      <Drawer
        open={Boolean(selectedSkill)}
        onOpenChange={(open) => !open && setSelectedSkill(null)}
        title={selectedSkill?.name ?? "Skill detail"}
      >
        {selectedSkill ? <SkillDetail skill={selectedSkill} /> : null}
      </Drawer>
    </main>
  );
}

function SnapshotSourceBar({
  source,
  loadError,
  commands,
  copyActions
}: {
  source: DashboardSourceInfo;
  loadError?: DashboardSourceInfo;
  commands: DashboardCommandSet;
  copyActions: CopyActions;
}) {
  const visibleError = loadError?.configured && loadError.error ? loadError : undefined;
  return (
    <div className="mb-5 rounded-lg border border-border bg-card px-4 py-3 shadow-panel">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <AnimatedBadge status={source.type === "local-snapshot" ? "success" : "warning"}>
              {source.label}
            </AnimatedBadge>
            <AnimatedBadge status={source.redacted ? "success" : "danger"}>
              redacted: {String(source.redacted)}
            </AnimatedBadge>
            <AnimatedBadge status={source.stale ? "warning" : "success"}>
              stale: {String(source.stale)}
            </AnimatedBadge>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{source.message}</p>
          {visibleError ? (
            <p className="mt-2 text-sm leading-6 text-destructive">
              Local snapshot was configured but not loaded: {visibleError.label}.
            </p>
          ) : null}
          {[...source.warnings, ...(visibleError?.warnings ?? [])].length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {[...source.warnings, ...(visibleError?.warnings ?? [])].map((warning) => (
                <span
                  key={warning}
                  className="rounded-full bg-warning/10 px-2 py-1 text-xs font-semibold text-amber-900 dark:text-amber-200"
                >
                  {warning}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:w-[560px]">
          <KeyValue label="Generated" value={source.generatedAt ? formatUtc(source.generatedAt) : "none"} />
          <KeyValue label="Loaded" value={formatUtc(source.loadedAt)} />
          <KeyValue label="Hash" value={source.snapshotHash ? shortHash(source.snapshotHash) : "none"} />
          <KeyValue label="Read only" value={String(source.readOnly)} />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <CopyActionButton
          copyId="source-copy-export"
          text={commands.exportSnapshot}
          successTitle="Snapshot export command copied"
          successDescription="Copied the redacted local snapshot export command."
          variant="outline"
          icon={<ClipboardCopy className="h-4 w-4" />}
          copyActions={copyActions}
        >
          Copy export
        </CopyActionButton>
        <CopyActionButton
          copyId="source-copy-load"
          text={commands.loadSnapshot}
          successTitle="Snapshot load command copied"
          successDescription="Copied the local dashboard load command."
          variant="outline"
          icon={<TerminalSquare className="h-4 w-4" />}
          copyActions={copyActions}
        >
          Copy load
        </CopyActionButton>
      </div>
    </div>
  );
}

function CopyActionButton({
  copyId,
  text,
  successTitle,
  successDescription,
  errorTitle,
  copyActions,
  children,
  ...props
}: {
  copyId: string;
  text: string;
  successTitle: string;
  successDescription?: string;
  errorTitle?: string;
  copyActions: CopyActions;
  children: ReactNode;
} & Omit<Parameters<typeof StatefulButton>[0], "state" | "onClick" | "children">) {
  return (
    <StatefulButton
      state={copyActions.states[copyId] ?? "idle"}
      successLabel="Copied"
      errorLabel="Failed"
      onClick={() =>
        void copyActions.copy({
          id: copyId,
          text,
          successTitle,
          successDescription,
          errorTitle
        })
      }
      {...props}
    >
      {children}
    </StatefulButton>
  );
}

function DashboardBrand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2 font-semibold text-foreground", !compact && "mb-7")}>
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-foreground text-background">
        <Route className="h-4 w-4" />
      </span>
      SkillMap
    </div>
  );
}

function SideNav({
  activeTab,
  onChange
}: {
  activeTab: DashboardTab;
  onChange: (tab: DashboardTab) => void;
}) {
  return (
    <nav className="space-y-1">
      {navItems.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition-colors [&_svg]:h-4 [&_svg]:w-4",
            activeTab === item.id
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </nav>
  );
}

function Overview({
  snapshot,
  sourceInfo,
  copyActions,
  commands
}: {
  snapshot: DashboardSnapshot;
  sourceInfo: DashboardSourceInfo;
  copyActions: CopyActions;
  commands: DashboardCommandSet;
}) {
  return (
    <div className="space-y-6">
      <PageTitle
        title={snapshot.status.label}
        text={`${snapshot.status.summary} Source: ${sourceInfo.label.toLowerCase()}.`}
        badge={snapshot.status.verdict}
        badgeStatus={snapshot.status.verdict === "ok" ? "success" : "warning"}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<Zap />}
          label="Tokens avoided"
          value={snapshot.tokenMetrics.tokensAvoidedVsCatalog ?? 0}
          helper={`${snapshot.tokenMetrics.sampleSize} prompt sample / ${snapshot.tokenMetrics.method}`}
        />
        <MetricCard
          icon={<Route />}
          label="Route count"
          value={snapshot.productivity.routeCount}
          helper={`${snapshot.productivity.avgRecommendations ?? 0} avg recommendations`}
        />
        <MetricCard
          icon={<Gauge />}
          label="Top-3 route hit"
          value={(snapshot.productivity.top3Rate ?? 0) * 100}
          suffix="%"
          helper="recorded eval sample"
        />
        <MetricCard
          icon={<ShieldCheck />}
          label="Eval confidence"
          textValue={snapshot.productivity.evalConfidence}
          helper={snapshot.productivity.releaseReady ? "inside release gate" : "needs gate work"}
        />
      </div>
      <div className="grid min-w-0 gap-4 xl:grid-cols-[1.08fr_0.92fr]">
        <RouteLab
          trace={snapshot.recentRouteTraces[0]}
          compact
          prompt={snapshot.recentRouteTraces[0]?.promptPreview ?? ""}
          copyActions={copyActions}
          commands={commands}
        />
        <div className="space-y-4">
          <StatusPanel snapshot={snapshot} />
          <ConnectorSummary snapshot={snapshot} />
        </div>
      </div>
    </div>
  );
}

function RouteLab({
  trace,
  prompt,
  onPromptChange,
  copyActions,
  commands,
  compact = false
}: {
  trace?: RouteTraceRecord;
  prompt: string;
  onPromptChange?: (value: string) => void;
  copyActions: CopyActions;
  commands: DashboardCommandSet;
  compact?: boolean;
}) {
  const traceCopyText = trace
    ? JSON.stringify(
        {
          id: trace.id,
          createdAt: trace.createdAt,
          promptPreview: trace.promptPreview,
          rawPromptStored: trace.rawPromptStored,
          recommendations: trace.recommendations,
          exclusions: trace.exclusions,
          hookText: trace.hookText,
          tokenEstimate: trace.tokenEstimate
        },
        null,
        2
      )
    : "";

  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="border-b border-border p-5">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div>
            <div className="mb-2">
              <AnimatedBadge status="warning">Recorded snapshot demo</AnimatedBadge>
            </div>
            <h2 className="text-xl font-semibold text-foreground">Route Lab</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              {compact
                ? "Recorded route evidence from the selected snapshot. No route or hook command runs in this dashboard."
                : "Edit the demo prompt to select a deterministic result from the loaded redacted traces. No route or hook command runs."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <CopyActionButton
              copyId={compact ? "copy-hook-overview" : "copy-hook-route"}
              text={trace?.hookText ?? ""}
              successTitle="Hook text copied"
              successDescription="Copied compact hook text only. No hook was installed."
              variant="secondary"
              icon={<ClipboardCopy className="h-4 w-4" />}
              copyActions={copyActions}
            >
              Copy hint
            </CopyActionButton>
            <CopyActionButton
              copyId={compact ? "copy-trace-overview" : "copy-trace-route"}
              text={traceCopyText}
              successTitle="Route trace copied"
              successDescription="Copied redacted trace JSON only."
              variant="outline"
              icon={<GitPullRequest className="h-4 w-4" />}
              copyActions={copyActions}
            >
              Copy trace
            </CopyActionButton>
            <CopyActionButton
              copyId={compact ? "copy-route-command-overview" : "copy-route-command-route"}
              text={commands.routeTrace}
              successTitle="Route command copied"
              successDescription="Copied a local read-only trace command."
              variant="outline"
              icon={<TerminalSquare className="h-4 w-4" />}
              copyActions={copyActions}
            >
              Copy command
            </CopyActionButton>
          </div>
        </div>
        {!compact ? (
          <div className="mt-4">
            <label htmlFor="route-demo-prompt" className="text-xs font-semibold text-foreground">
              Deterministic demo prompt
            </label>
            <Textarea
              id="route-demo-prompt"
              value={prompt}
              onChange={(event) => onPromptChange?.(event.target.value)}
              aria-describedby="route-demo-explanation route-demo-result"
              className="mt-2 min-h-24 bg-background"
            />
            <p id="route-demo-explanation" className="mt-2 text-xs leading-5 text-muted-foreground">
              Changing this text deterministically selects a recorded, redacted trace from the current snapshot. It does not call a model, connector, or CLI command.
            </p>
            <p id="route-demo-result" className="mt-1 text-xs font-semibold text-foreground" aria-live="polite">
              Showing recorded trace: {trace?.id ?? "none"}
            </p>
          </div>
        ) : null}
      </div>

      <div className="grid min-w-0 gap-0 xl:grid-cols-[1fr_0.78fr]">
        <div className="space-y-3 p-5">
          {(trace?.recommendations ?? []).length === 0 ? (
            <EmptyState
              icon={<AlertTriangle />}
              title="No confident route"
              text="Ask for more target context instead of loading broad skills."
            />
          ) : (
            trace?.recommendations.map((candidate) => (
              <div key={candidate.name} className="rounded-lg border border-border bg-background p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-all font-semibold text-foreground">{candidate.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {candidate.family ?? "unclassified"} / {candidate.tier}
                    </p>
                  </div>
                  <AnimatedBadge status="success">{Math.round(candidate.score * 100)}%</AnimatedBadge>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {candidate.reasons.map((reason) => (
                    <span
                      key={reason}
                      className="rounded-full bg-card px-2 py-1 text-[11px] text-muted-foreground"
                    >
                      {reason}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="border-t border-border bg-accent/24 p-5 xl:border-l xl:border-t-0">
          <div className="rounded-lg border border-border bg-background p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-muted-foreground">Hook text</p>
              <AnimatedBadge status="neutral">{trace?.hookChars ?? 0} chars</AnimatedBadge>
            </div>
            <p className="break-words text-sm leading-6 text-foreground">
              {trace?.hookText ?? "No hook text in this snapshot."}
            </p>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <SmallStat label="Hook tokens" value={trace?.tokenEstimate.hookTokens ?? 0} />
            <SmallStat
              label="Catalog avoided"
              value={trace?.tokenEstimate.catalogTokensAvoided ?? 0}
            />
          </div>
          <div className="mt-3 rounded-lg border border-border bg-background p-3">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Exclusions</p>
            <div className="space-y-2">
              {(trace?.exclusions ?? []).length > 0 ? (
                trace?.exclusions.map((exclusion) => (
                  <div key={`${trace.id}-${exclusion.name}`} className="flex gap-2 text-sm">
                    <AnimatedBadge
                      status={exclusion.severity === "blocked" ? "danger" : "warning"}
                    >
                      {exclusion.severity}
                    </AnimatedBadge>
                    <p className="min-w-0 break-words text-muted-foreground">
                      <span className="font-semibold text-foreground">{exclusion.name}:</span>{" "}
                      {exclusion.reason}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No exclusions in this snapshot.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function SkillsPanel({
  skills,
  selectedIds,
  onSelectedIds,
  onOpenSkill,
  onToast,
  copyActions,
  commands
}: {
  skills: SkillTableRow[];
  selectedIds: string[];
  onSelectedIds: (ids: string[]) => void;
  onOpenSkill: (skill: SkillTableRow) => void;
  onToast: (toast: ToastInput) => void;
  copyActions: CopyActions;
  commands: DashboardCommandSet;
}) {
  const columns: TableColumn<SkillTableRow>[] = [
    {
      key: "name",
      header: "Skill",
      width: "260px",
      cell: (skill) => <span className="font-semibold text-foreground">{skill.name}</span>
    },
    {
      key: "tier",
      header: "Tier",
      width: "120px",
      cell: (skill) => (
        <AnimatedBadge status={skill.tier === "blocked" ? "danger" : "info"}>
          {skill.tier}
        </AnimatedBadge>
      )
    },
    { key: "family", header: "Family", width: "150px", cell: (skill) => skill.family ?? "unclassified" },
    {
      key: "hasScripts",
      header: "Scripts",
      width: "105px",
      cell: (skill) => (
        <AnimatedBadge status={skill.hasScripts ? "warning" : "success"}>
          {skill.hasScripts ? "yes" : "no"}
        </AnimatedBadge>
      )
    },
    {
      key: "routeEligible",
      header: "Route",
      width: "120px",
      cell: (skill) => (
        <AnimatedBadge status={skill.routeEligible ? "success" : "warning"}>
          {skill.routeEligible ? "eligible" : "held"}
        </AnimatedBadge>
      )
    },
    {
      key: "sourceState",
      header: "Source",
      width: "120px",
      cell: (skill) => <AnimatedBadge status={sourceTone(skill.sourceState)}>{skill.sourceState}</AnimatedBadge>
    },
    {
      key: "reviewStatus",
      header: "Review",
      width: "140px",
      cell: (skill) => (
        <AnimatedBadge status={skill.reviewStatus === "reviewed" ? "success" : "warning"}>
          {skill.reviewStatus}
        </AnimatedBadge>
      )
    },
    {
      key: "bodyBytes",
      header: "Body",
      align: "right",
      width: "100px",
      cell: (skill) => `${compactNumber(skill.bodyBytes)}B`,
      sortValue: (skill) => skill.bodyBytes
    },
    {
      key: "descriptionBytes",
      header: "Desc",
      align: "right",
      width: "100px",
      cell: (skill) => `${compactNumber(skill.descriptionBytes)}B`,
      sortValue: (skill) => skill.descriptionBytes
    },
    {
      key: "lastHash",
      header: "Hash",
      width: "160px",
      cell: (skill) => <span className="mono text-xs">{skill.lastHash}</span>
    },
    { key: "routeCount", header: "Routes", align: "right", width: "100px", sortValue: (skill) => skill.routeCount }
  ];

  return (
    <section className="space-y-4">
      <PageTitle
        title="Inventory with route and trust state"
        text="The table is selectable, sortable, virtualized, and backed by metadata from the selected redacted snapshot."
      />
      <DataTable
        data={skills}
        columns={columns}
        getRowId={(skill) => skill.id}
        selectedRowIds={selectedIds}
        onSelectionChange={onSelectedIds}
        onRowOpen={onOpenSkill}
        height={430}
        className="rounded-lg"
      />
      {selectedIds.length > 0 ? (
        <div className="fixed inset-x-4 bottom-4 z-40 flex max-w-[calc(100vw-2rem)] flex-wrap items-center justify-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-2xl sm:left-1/2 sm:right-auto sm:w-max sm:-translate-x-1/2 sm:rounded-full">
          <AnimatedBadge status="info">{selectedIds.length} selected</AnimatedBadge>
          <CopyActionButton
            copyId="copy-selected-route-command"
            text={commands.routeTrace}
            successTitle="Route command copied"
            successDescription={`${selectedIds.length} selected rows stay in the browser; copied a local route trace command only.`}
            variant="secondary"
            icon={<ClipboardCopy className="h-4 w-4" />}
            copyActions={copyActions}
          >
            Copy command
          </CopyActionButton>
          <Button
            variant="outline"
            icon={<FileSearch className="h-4 w-4" />}
            onClick={() =>
              onToast({
                status: "info",
                title: "Selection preview",
                description: `${selectedIds.length} selected skill rows. No review was recorded or submitted.`
              })
            }
          >
            Preview selection
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function PolicyPanel({
  rows,
  copyActions
}: {
  rows: PolicyReviewRow[];
  copyActions: CopyActions;
}) {
  return (
    <section className="space-y-4">
      <PageTitle
        title="Queues that keep routing honest"
        text="Duplicates, explicit-only skills, blocked entries, and unmatched policy rows stay visible before rollout."
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {["duplicate", "unmatched", "explicit-only", "blocked"].map((queue) => (
          <QueueCard key={queue} queue={queue} rows={rows} />
        ))}
      </div>
      <div className="grid gap-3">
        {rows.map((row) => (
          <Card key={row.id} className="p-4">
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <AnimatedBadge status={row.state === "ready" ? "success" : "warning"}>
                    {row.queue}
                  </AnimatedBadge>
                  <AnimatedBadge status="neutral">{row.state}</AnimatedBadge>
                </div>
                <h3 className="font-semibold text-foreground">{row.name}</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{row.reason}</p>
              </div>
              <CopyActionButton
                copyId={`copy-policy-${row.id}`}
                text={row.nextAction}
                successTitle="Next action copied"
                successDescription="Copied a read-only review instruction."
                variant="secondary"
                icon={<ClipboardCopy className="h-4 w-4" />}
                copyActions={copyActions}
              >
                Copy action
              </CopyActionButton>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

function TrustPanel({ snapshot }: { snapshot: DashboardSnapshot }) {
  const receipt = snapshot.curationReceipt;
  return (
    <section className="space-y-4">
      <PageTitle
        title="Receipts, labels, and redaction"
        text="The dashboard says exactly what is verified, user-reported, stale, held, fixture-only, or missing."
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <TrustCard
          icon={<ShieldCheck />}
          label="Model verification"
          value={receipt?.modelLabel ?? "missing receipt"}
          status={receipt ? "success" : "warning"}
        />
        <TrustCard icon={<Braces />} label="Raw prompts stored" value="false" status="success" />
        <TrustCard
          icon={<TerminalSquare />}
          label="Read-only connector"
          value={String(snapshot.connector.readOnlyMode)}
          status={snapshot.connector.readOnlyMode ? "success" : "danger"}
        />
      </div>
      <Card className="p-4">
        <h3 className="font-semibold text-foreground">Curation receipt</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <KeyValue label="Curator" value={receipt?.curator ?? "missing"} />
          <KeyValue label="Recorded" value={receipt ? formatUtc(receipt.recordedAt) : "missing"} />
          <KeyValue label="Policy hash" value={receipt?.policyHash ?? "missing"} />
          <KeyValue label="Warnings" value={snapshot.status.warnings.length.toString()} />
        </div>
      </Card>
    </section>
  );
}

function SourcesPanel({ rows, onToast }: { rows: SourceRow[]; onToast: (toast: ToastInput) => void }) {
  const columns: TableColumn<SourceRow>[] = [
    { key: "name", header: "Source", width: "220px" },
    { key: "source", header: "Origin", width: "260px" },
    {
      key: "state",
      header: "State",
      width: "120px",
      cell: (row) => <AnimatedBadge status={sourceTone(row.state)}>{row.state}</AnimatedBadge>
    },
    {
      key: "reviewStatus",
      header: "Review",
      width: "150px",
      cell: (row) => (
        <AnimatedBadge status={row.reviewStatus === "reviewed" ? "success" : "warning"}>
          {row.reviewStatus}
        </AnimatedBadge>
      )
    },
    { key: "nextAction", header: "Next action", width: "260px" }
  ];

  return (
    <section className="min-w-0 space-y-4">
      <PageTitle
        title="External provenance without silent updates"
        text="Source rows expose freshness and risk while update application stays behind a local approval flow."
      />
      <DataTable
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        onRowOpen={(row) =>
          onToast({
            status: "info",
            title: row.name,
            description: row.nextAction
          })
        }
        height={370}
        className="rounded-lg"
      />
    </section>
  );
}

function ConnectorPanel({
  snapshot,
  sourceInfo,
  commands,
  copyActions
}: {
  snapshot: DashboardSnapshot;
  sourceInfo: DashboardSourceInfo;
  commands: DashboardCommandSet;
  copyActions: CopyActions;
}) {
  const connector = snapshot.connector;
  return (
    <section className="min-w-0 space-y-4">
      <PageTitle
        title={`Snapshot handoff is ${connector.state}`}
        text={connector.message}
        badge={connector.state}
        badgeStatus={connectorTone(connector.state)}
      />
      <div className="grid min-w-0 gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <Card className="min-w-0 p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <AnimatedBadge status={connectorTone(connector.state)}>{connector.state}</AnimatedBadge>
            <Tooltip label="This dashboard reads redacted snapshots and copies commands for the operator. It cannot run commands or mutate local skill roots." />
          </div>
          <div className="grid gap-3">
            <KeyValue label="CLI version" value={connector.cliVersion ?? "unknown"} />
            <KeyValue label="Project alias" value={connector.cwdAlias ?? "$PROJECT"} />
            <KeyValue label="Last snapshot" value={connector.lastSnapshotHash ?? "none"} />
            <KeyValue label="Redaction enabled" value={String(connector.redactionEnabled)} />
            <KeyValue label="Read-only mode" value={String(connector.readOnlyMode)} />
            <KeyValue label="Source" value={sourceInfo.label} />
            <KeyValue label="Stale" value={String(sourceInfo.stale)} />
          </div>
        </Card>
        <Card className="min-w-0 p-4">
          <h3 className="font-semibold text-foreground">Allowed local commands</h3>
          <div className="mt-4 space-y-2">
            {connector.allowedCommands.map((command) => (
              <div
                key={command}
                className="mono max-w-full break-all rounded-lg border border-border bg-background px-3 py-2 text-xs leading-5 text-foreground [overflow-wrap:anywhere]"
              >
                {command}
              </div>
            ))}
          </div>
          {connector.nextCommand ? (
            <CopyActionButton
              copyId="copy-connector-next-command"
              text={connector.nextCommand}
              successTitle="Connector command copied"
              successDescription="Copied a read-only local command. The dashboard did not run it."
              className="mt-4"
              icon={<ClipboardCopy className="h-4 w-4" />}
              copyActions={copyActions}
            >
              Copy command
            </CopyActionButton>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <CopyActionButton
              copyId="copy-snapshot-export-command"
              text={commands.exportSnapshot}
              successTitle="Snapshot export command copied"
              successDescription="Copied the redacted dashboard snapshot export command."
              variant="outline"
              icon={<ClipboardCopy className="h-4 w-4" />}
              copyActions={copyActions}
            >
              Copy export
            </CopyActionButton>
            <CopyActionButton
              copyId="copy-snapshot-load-command"
              text={commands.loadSnapshot}
              successTitle="Snapshot load command copied"
              successDescription="Copied the SKILLMAP_DASHBOARD_SNAPSHOT local run command."
              variant="outline"
              icon={<TerminalSquare className="h-4 w-4" />}
              copyActions={copyActions}
            >
              Copy load
            </CopyActionButton>
          </div>
        </Card>
      </div>
    </section>
  );
}

function QaPanel({ snapshot }: { snapshot: DashboardSnapshot }) {
  const gates = [
    {
      label: "Top-3 route rate",
      value: percent(snapshot.productivity.top3Rate),
      pass: (snapshot.productivity.top3Rate ?? 0) >= 0.95
    },
    {
      label: "Avoid hits",
      value: String(snapshot.productivity.avoidHits ?? 0),
      pass: (snapshot.productivity.avoidHits ?? 0) === 0
    },
    { label: "Redaction", value: String(snapshot.redacted), pass: snapshot.redacted },
    {
      label: "Release ready",
      value: String(snapshot.productivity.releaseReady),
      pass: snapshot.productivity.releaseReady
    }
  ];

  return (
    <section className="space-y-4">
      <PageTitle
        title="Release-readiness gates"
        text="The dashboard makes eval confidence and release blockers visible before the skill map is shared."
      />
      <div className="grid gap-3 md:grid-cols-2">
        {gates.map((gate) => (
          <Card key={gate.label} className="p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold text-foreground">{gate.label}</p>
              <AnimatedBadge status={gate.pass ? "success" : "warning"}>
                {gate.pass ? "pass" : "review"}
              </AnimatedBadge>
            </div>
            <p className="mt-3 text-2xl font-semibold text-foreground">{gate.value}</p>
          </Card>
        ))}
      </div>
      <Card className="p-4">
        <h3 className="font-semibold text-foreground">Current warnings</h3>
        <div className="mt-3 space-y-2">
          {snapshot.status.warnings.length > 0 ? (
            snapshot.status.warnings.map((warning) => (
              <div key={warning} className="flex gap-2 rounded-lg bg-warning/10 p-3 text-sm text-amber-900 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {warning}
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No current warnings in this snapshot.</p>
          )}
        </div>
      </Card>
    </section>
  );
}

function StatusPanel({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <AnimatedBadge status={snapshot.status.verdict === "ok" ? "success" : "warning"}>
          {snapshot.status.verdict}
        </AnimatedBadge>
        <h3 className="font-semibold text-foreground">Next actions</h3>
      </div>
      <div className="space-y-2">
        {snapshot.status.nextActions.map((action) => (
          <div key={action} className="flex gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            {action}
          </div>
        ))}
      </div>
    </Card>
  );
}

function ConnectorSummary({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-semibold text-foreground">Connector</h3>
        <AnimatedBadge status={connectorTone(snapshot.connector.state)}>
          {snapshot.connector.state}
        </AnimatedBadge>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">{snapshot.connector.message}</p>
      <div className="mt-3 grid gap-2">
        <KeyValue label="Redacted" value={String(snapshot.connector.redactionEnabled)} />
        <KeyValue label="Read only" value={String(snapshot.connector.readOnlyMode)} />
      </div>
    </Card>
  );
}

function SkillDetail({ skill }: { skill: SkillTableRow }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <AnimatedBadge status={skill.routeEligible ? "success" : "warning"}>
          {skill.routeEligible ? "route eligible" : "held from route"}
        </AnimatedBadge>
        <AnimatedBadge status={skill.hasScripts ? "warning" : "success"}>
          {skill.hasScripts ? "has scripts" : "no scripts"}
        </AnimatedBadge>
        <AnimatedBadge status="info">{skill.trustLabel}</AnimatedBadge>
      </div>
      <div className="rounded-lg border border-border bg-background p-4">
        <h3 className="font-semibold text-foreground">Reason trace</h3>
        <div className="mt-3 space-y-2">
          {skill.reasonHints.map((hint) => (
            <div key={hint} className="rounded-lg bg-card px-3 py-2 text-sm text-muted-foreground">
              {hint}
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-3">
        <KeyValue label="Family" value={skill.family ?? "unclassified"} />
        <KeyValue label="Source state" value={skill.sourceState} />
        <KeyValue label="Review" value={skill.reviewStatus} />
        <KeyValue label="Body bytes" value={skill.bodyBytes.toLocaleString()} />
        <KeyValue label="Description bytes" value={skill.descriptionBytes.toLocaleString()} />
        <KeyValue label="Route count" value={skill.routeCount.toString()} />
      </div>
    </div>
  );
}

function PageTitle({
  title,
  text,
  badge,
  badgeStatus = "info"
}: {
  title: string;
  text: string;
  badge?: string;
  badgeStatus?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  return (
    <div className="mb-2 max-w-4xl">
      {badge ? (
        <div className="mb-3">
          <AnimatedBadge status={badgeStatus}>{badge}</AnimatedBadge>
        </div>
      ) : null}
      <h1 className="text-2xl font-semibold tracking-normal text-foreground sm:text-3xl">
        {title}
      </h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  textValue,
  suffix = "",
  helper
}: {
  icon: JSX.Element;
  label: string;
  value?: number;
  textValue?: string;
  suffix?: string;
  helper: string;
}) {
  return (
    <Card className="p-4">
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:h-5 [&_svg]:w-5">
        {icon}
      </span>
      <p className="mt-4 text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-foreground">
        {textValue ?? <AnimatedNumber value={value ?? 0} suffix={suffix} />}
      </p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{helper}</p>
    </Card>
  );
}

function SmallStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-semibold text-foreground">
        <AnimatedNumber value={value} />
      </p>
    </div>
  );
}

function QueueCard({ queue, rows }: { queue: string; rows: PolicyReviewRow[] }) {
  const count = rows.filter((row) => row.queue === queue).length;
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold text-muted-foreground">{queue}</p>
      <p className="mt-2 text-3xl font-semibold text-foreground">{count}</p>
      <p className="mt-1 text-xs text-muted-foreground">policy review rows</p>
    </Card>
  );
}

function TrustCard({
  icon,
  label,
  value,
  status
}: {
  icon: JSX.Element;
  label: string;
  value: string;
  status: "success" | "warning" | "danger";
}) {
  return (
    <Card className="p-4">
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:h-5 [&_svg]:w-5">
        {icon}
      </span>
      <p className="mt-4 text-xs font-semibold text-muted-foreground">{label}</p>
      <div className="mt-2">
        <AnimatedBadge status={status}>{value}</AnimatedBadge>
      </div>
    </Card>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        title={value}
        className="mono min-w-0 break-all text-right text-xs font-semibold text-foreground [overflow-wrap:anywhere]"
      >
        {value}
      </span>
    </div>
  );
}

function EmptyState({ icon, title, text }: { icon: JSX.Element; title: string; text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-background p-6 text-center">
      <span className="mx-auto grid h-10 w-10 place-items-center rounded-lg bg-warning/10 text-warning [&_svg]:h-5 [&_svg]:w-5">
        {icon}
      </span>
      <p className="mt-3 font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function connectorTone(state: ConnectorState) {
  if (state === "online") return "success";
  if (state === "blocked" || state === "unauthorized") return "danger";
  return "warning";
}

function sourceTone(state: SourceState) {
  if (state === "clean" || state === "local") return "success";
  if (state === "stale" || state === "unknown" || state === "modified") return "warning";
  if (state === "risky" || state === "error") return "danger";
  return "neutral";
}

function formatUtc(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function shortHash(value: string) {
  if (!value.startsWith("sha256:")) return value;
  return `sha256:${value.slice(7, 19)}`;
}

function initialRoutePrompt(data: DashboardPageData) {
  const initialSnapshot =
    data.initialView === "local-snapshot" && data.localSnapshot
      ? data.localSnapshot
      : data.fixtures[data.initialView as SnapshotMode];
  return initialSnapshot?.recentRouteTraces[0]?.promptPreview ?? "Inspect this recorded route";
}

function selectRecordedTrace(traces: RouteTraceRecord[], prompt: string) {
  if (traces.length === 0) return undefined;
  const normalized = prompt.trim().toLocaleLowerCase();
  const exact = traces.find(
    (trace) => (trace.promptPreview ?? "").trim().toLocaleLowerCase() === normalized
  );
  if (exact) return exact;
  let hash = 2166136261;
  for (const character of normalized) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return traces[Math.abs(hash) % traces.length];
}
