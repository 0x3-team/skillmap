"use client";

import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { AlertTriangle, Flag } from "lucide-react";
import { useRef, useState, type FormEvent, type Ref } from "react";
import {
  reportSuspiciousListing,
  reportSuspiciousListingProgressive,
  type ReportActionState
} from "@/app/skills/[publisher]/[slug]/report-actions";
import { REPORT_CATEGORY_COPY, REPORT_CATEGORIES, type ReportField } from "@/lib/reports/input";
import type { ReportCategory } from "@/lib/reports/input";
import type { ReportSubmitStatus } from "@/lib/reports/status";

export function ReportForm({
  skillId,
  versionId,
  returnPath,
  requestId,
  initialCategory = "",
  initialMessage = ""
}: {
  skillId: string;
  versionId: string;
  returnPath: string;
  requestId: string;
  initialCategory?: ReportCategory | "";
  initialMessage?: string;
}) {
  const [result, setResult] = useState<ReportActionState | null>(null);
  const [pending, setPending] = useState(false);
  const noticeRef = useRef<HTMLDivElement>(null);
  const control = "mt-2 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";
  const invalidField = result?.status === "invalid" ? result.field : undefined;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setResult(null);
    setPending(true);
    void (async () => {
      let actionResult: ReportActionState;
      try {
        actionResult = await reportSuspiciousListing(formData);
      } catch (error) {
        unstable_rethrow(error);
        actionResult = { status: "service-unavailable" };
      } finally {
        setPending(false);
      }
      setResult(actionResult);
      window.requestAnimationFrame(() => focusReportResult(actionResult, noticeRef.current));
    })();
  }

  return (
    <form action={reportSuspiciousListingProgressive} onSubmit={handleSubmit} className="mt-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
      {result ? <ReportStatusNotice noticeRef={noticeRef} status={result.status} reportId={result.reportId ?? null} field={result.field ?? null} validationMessage={result.message} /> : null}
      <input type="hidden" name="skillId" value={skillId} />
      <input type="hidden" name="versionId" value={versionId} />
      <input type="hidden" name="returnPath" value={returnPath} />
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="report-category" className="text-sm font-semibold">Concern category</label>
          <select id="report-category" name="category" required defaultValue={initialCategory} aria-invalid={invalidField === "category"} aria-describedby={invalidField === "category" ? "report-category-error" : undefined} className={`${control} h-11`}>
            <option value="">Choose one category</option>
            {REPORT_CATEGORIES.map((category) => <option key={category} value={category}>{REPORT_CATEGORY_COPY[category].label}</option>)}
          </select>
          {invalidField === "category" ? <p id="report-category-error" className="mt-2 text-xs font-semibold text-destructive">{result?.message}</p> : null}
        </div>
        <div>
          <label htmlFor="report-idempotencyKey" className="text-sm font-semibold">Request ID</label>
          <input id="report-idempotencyKey" name="idempotencyKey" value={requestId} readOnly aria-invalid={invalidField === "idempotencyKey"} aria-describedby={invalidField === "idempotencyKey" ? "report-idempotencyKey-error" : undefined} className={`${control} mono h-11 bg-muted/50 text-xs`} />
          {invalidField === "idempotencyKey" ? <p id="report-idempotencyKey-error" className="mt-2 text-xs font-semibold text-destructive">{result?.message}</p> : null}
        </div>
      </div>
      <div className="mt-5">
        <label htmlFor="report-message" className="text-sm font-semibold">What is wrong with this listing?</label>
        <p id="report-message-hint" className="mt-1 text-xs leading-5 text-muted-foreground">10–2,000 characters. Use one normalized paragraph; line breaks and control characters are rejected. Do not include credentials, private prompts, patient data, or workspace contents.</p>
        <textarea id="report-message" name="message" required minLength={10} maxLength={2000} rows={5} defaultValue={initialMessage} aria-invalid={invalidField === "message"} aria-describedby={`report-message-hint${invalidField === "message" ? " report-message-error" : ""}`} className={`${control} resize-y py-3`} />
        {invalidField === "message" ? <p id="report-message-error" className="mt-2 text-xs font-semibold text-destructive">{result?.message}</p> : null}
      </div>
      <div className="mt-5 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="mono break-all text-[11px] text-muted-foreground">{skillId} · {versionId}</p>
        <button type="submit" disabled={pending} aria-disabled={pending} className="press inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-foreground px-4 text-sm font-semibold text-background disabled:cursor-wait disabled:opacity-70"><Flag className="h-4 w-4" />{pending ? "Checking report…" : "Queue private report"}</button>
      </div>
    </form>
  );
}

export const ReportStatusNotice = function ReportStatusNotice({
  noticeRef,
  status,
  reportId,
  field,
  validationMessage
}: {
  noticeRef?: Ref<HTMLDivElement>;
  status: ReportSubmitStatus;
  reportId: string | null;
  field: ReportField | string | null;
  validationMessage?: string;
}) {
  const messages: Record<ReportSubmitStatus, { title: string; body: string; tone: string }> = {
    "active-limit": { title: "Queued-report limit reached", body: "This account already has 5 queued listing reports. No new report was created; wait for an operator disposition before retrying. Your category, message, and request ID remain in this form.", tone: "border-warning/35 bg-warning/10" },
    "auth-unavailable": { title: "Authentication could not be verified", body: "No report was accepted. Your safe form values remain available while hosted authentication recovers.", tone: "border-warning/35 bg-warning/10" },
    cooldown: { title: "Report cooldown is active", body: "This account already reported this exact version/category within 24 hours. No additional report was created; your safe form values remain available.", tone: "border-warning/35 bg-warning/10" },
    "daily-limit": { title: "Daily report limit reached", body: "This account already created 20 listing reports in the rolling 24-hour window. No new report was created; your safe form values remain available.", tone: "border-warning/35 bg-warning/10" },
    duplicate: { title: "That report request already exists", body: reportId ? `Existing report ${reportId} remains the account-owned source of truth. No second report was created.` : "No second report was created. Open your report history to review the existing request.", tone: "border-warning/35 bg-warning/10" },
    invalid: { title: "Report input was rejected", body: validationMessage ?? (field ? `The ${humanizeField(field)} field was not canonical. No report was created; every other safe value remains in this form.` : "One or more fields were invalid. No report was created; safe values remain in this form."), tone: "border-destructive/30 bg-destructive/10" },
    queued: { title: "Private report queued", body: reportId ? `Report ${reportId} is now visible in your account history.` : "The report was accepted and is now visible in your account history.", tone: "border-primary/30 bg-primary/10" },
    "service-unavailable": { title: "Reporting service unavailable", body: "The write could not be confirmed, so SkillMap does not claim that a report was created. Your category, message, and request ID remain in this form for a retry.", tone: "border-warning/35 bg-warning/10" },
    "target-unavailable": { title: "This exact listing cannot be reported", body: "The skill/version pair is no longer the exact current public listing. No report was created; reload the catalog before retrying.", tone: "border-warning/35 bg-warning/10" }
  };
  const message = messages[status];
  return <div ref={noticeRef} tabIndex={-1} className={`mb-5 mt-5 rounded-xl border p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring ${message.tone}`} role={status === "invalid" ? "alert" : "status"}><p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />{message.title}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{message.body}</p>{status === "queued" || status === "duplicate" ? <Link href="/account/reports" className="mt-2 inline-flex text-sm font-semibold text-primary underline underline-offset-4">View report history</Link> : null}</div>;
};

function humanizeField(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function focusReportResult(result: ReportActionState, notice: HTMLDivElement | null) {
  const target = result.field ? document.getElementById(`report-${result.field}`) : null;
  (target ?? notice)?.focus();
}
