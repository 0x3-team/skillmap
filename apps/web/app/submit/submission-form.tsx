"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, FileKey2 } from "lucide-react";
import {
  submitSkill,
  submitSkillProgressive,
  type SubmissionActionState
} from "@/app/submit/actions";
import { APPROVED_ALPHA_SPDX_IDENTIFIERS, type SubmissionField } from "@/lib/submissions/input";

export function SubmissionForm({ requestId }: { requestId: string }) {
  const [validation, setValidation] = useState<SubmissionActionState | null>(null);
  const [pending, setPending] = useState(false);
  const noticeRef = useRef<HTMLDivElement>(null);
  const inputClass = "mt-2 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground shadow-sm placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";
  const errorFor = (field: SubmissionField) => validation?.status === "invalid" && validation.field === field ? validation.message : null;
  const describedBy = (field: SubmissionField) => `${field}-hint${errorFor(field) ? ` ${field}-error` : ""}`;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setValidation(null);
    setPending(true);
    void (async () => {
      try {
        const result = await submitSkill(formData);
        setValidation(result);
        window.requestAnimationFrame(() => {
          if (result.status === "invalid") document.getElementById(result.field)?.focus();
          else noticeRef.current?.focus();
        });
      } catch {
        setValidation({
          status: "service-unavailable",
          message: "The request could not be confirmed. Your entries and request ID remain in this form so you can retry safely."
        });
        window.requestAnimationFrame(() => noticeRef.current?.focus());
      } finally {
        setPending(false);
      }
    })();
  }

  return (
    <form action={submitSkillProgressive} onSubmit={handleSubmit} className="surface min-w-0 rounded-2xl p-5 sm:p-8">
      <div className="flex items-start gap-3 border-b border-border pb-6">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><FileKey2 className="h-5 w-5" /></span>
        <div>
          <h2 className="text-xl font-semibold">Immutable source coordinates</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Every field is validated again on the server before an account-owned queued row can be inserted.</p>
        </div>
      </div>

      {validation ? (
        <div ref={noticeRef} tabIndex={-1} className={`mt-5 rounded-xl border p-4 outline-none focus:ring-2 focus:ring-primary/30 ${validation.status === "invalid" ? "border-destructive/30 bg-destructive/10" : "border-warning/35 bg-warning/10"}`} role="alert" aria-live="polite">
          <p className="font-semibold">{validation.status === "invalid" ? "Correct the highlighted field" : "Submission service unavailable"}</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{validation.status === "invalid" ? "Your other entries and request ID remain in this form. No submission was created." : validation.message}</p>
        </div>
      ) : null}

      <div className="mt-6 grid gap-5">
        <Field field="repositoryUrl" label="Public GitHub repository URL" hint="Lowercase owner and repository; no .git suffix, trailing slash, query, or fragment." error={errorFor("repositoryUrl")}>
          <input id="repositoryUrl" name="repositoryUrl" type="url" required maxLength={226} autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={Boolean(errorFor("repositoryUrl"))} aria-describedby={describedBy("repositoryUrl")} placeholder="https://github.com/owner/repository" className={inputClass} />
        </Field>

        <Field field="sourceCommit" label="Exact commit" hint="Full lowercase 40- or 64-character commit digest. Branches and tags are rejected." error={errorFor("sourceCommit")}>
          <input id="sourceCommit" name="sourceCommit" type="text" required minLength={40} maxLength={64} pattern="(?:[0-9a-f]{40}|[0-9a-f]{64})" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={Boolean(errorFor("sourceCommit"))} aria-describedby={describedBy("sourceCommit")} placeholder="0123456789abcdef…" className={`${inputClass} mono`} />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field field="sourcePath" label="Relative skill path" hint="Normalized path ending in SKILL.md." error={errorFor("sourcePath")}>
            <input id="sourcePath" name="sourcePath" type="text" required minLength={8} maxLength={500} autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={Boolean(errorFor("sourcePath"))} aria-describedby={describedBy("sourcePath")} placeholder="skills/example/SKILL.md" className={`${inputClass} mono`} />
          </Field>
          <Field field="versionLabel" label="Version label" hint="The submitter's version label; not a verified release claim." error={errorFor("versionLabel")}>
            <input id="versionLabel" name="versionLabel" type="text" required maxLength={100} autoCorrect="off" aria-invalid={Boolean(errorFor("versionLabel"))} aria-describedby={describedBy("versionLabel")} placeholder="v1.0.0" className={inputClass} />
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field field="licenseClaim" label="License claim" hint="Optional claim only; operator evidence determines license status." error={errorFor("licenseClaim")}>
            <select id="licenseClaim" name="licenseClaim" defaultValue="" aria-invalid={Boolean(errorFor("licenseClaim"))} aria-describedby={describedBy("licenseClaim")} className={inputClass}>
              <option value="">No license claim</option>
              {APPROVED_ALPHA_SPDX_IDENTIFIERS.map((identifier) => <option key={identifier} value={identifier}>{identifier}</option>)}
            </select>
          </Field>
          <Field field="idempotencyKey" label="Request ID" hint="Generated once for idempotent submission retries." error={errorFor("idempotencyKey")}>
            <input id="idempotencyKey" name="idempotencyKey" type="text" readOnly value={requestId} aria-invalid={Boolean(errorFor("idempotencyKey"))} aria-describedby={describedBy("idempotencyKey")} className={`${inputClass} mono bg-muted/50 text-xs`} />
          </Field>
        </div>
      </div>

      <fieldset className="mt-7 border-t border-border pt-6">
        <legend className="text-sm font-semibold">Required acknowledgements</legend>
        <div className="mt-3 grid gap-3">
          <Acknowledgement name="authorizationAcknowledgement" error={errorFor("authorizationAcknowledgement")}>
            I am authorized by the repository owner or applicable license to request review and a public metadata listing.
          </Acknowledgement>
          <Acknowledgement name="untrustedContentAcknowledgement" error={errorFor("untrustedContentAcknowledgement")}>
            I understand SkillMap treats every submitted file as untrusted, performs static inspection only, and may reject or withdraw the submission.
          </Acknowledgement>
        </div>
      </fieldset>

      <div className="mt-7 flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-muted-foreground">Policy public-alpha-draft/v1 · free submission · no billing · operator review required · max 3 active and 10 new requests per rolling 24 hours</p>
        <button type="submit" disabled={pending} aria-disabled={pending} className="press inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:brightness-95 disabled:cursor-wait disabled:opacity-70">
          {pending ? "Checking submission…" : "Queue submission"} <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </form>
  );
}

function Field({ field, label, hint, error, children }: { field: SubmissionField; label: string; hint: string; error: string | null; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={field} className="text-sm font-semibold">{label}</label>
      <p id={`${field}-hint`} className="mt-1 text-xs leading-5 text-muted-foreground">{hint}</p>
      <div>{children}</div>
      {error ? <p id={`${field}-error`} className="mt-2 text-xs font-semibold leading-5 text-destructive">{error}</p> : null}
    </div>
  );
}

function Acknowledgement({ name, error, children }: { name: "authorizationAcknowledgement" | "untrustedContentAcknowledgement"; error: string | null; children: ReactNode }) {
  return (
    <div>
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-background/70 p-4 text-sm leading-6 hover:border-primary/35">
        <input id={name} type="checkbox" name={name} value="acknowledged" required aria-invalid={Boolean(error)} aria-describedby={error ? `${name}-error` : undefined} className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" />
        <span>{children}</span>
      </label>
      {error ? <p id={`${name}-error`} className="mt-2 text-xs font-semibold leading-5 text-destructive">{error}</p> : null}
    </div>
  );
}
