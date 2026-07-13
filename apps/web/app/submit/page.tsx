import { randomUUID } from "node:crypto";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, Github, LockKeyhole, ScanSearch } from "lucide-react";
import { SubmissionForm } from "@/app/submit/submission-form";
import { CatalogHeader } from "@/components/skillmap/catalog-header";
import { classifyVerifiedClaims } from "@/lib/auth/errors";
import { buildPublicPageMetadata } from "@/lib/metadata";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseSubmissionPublicId, parseSubmitStatus, type SubmitStatus } from "@/lib/submissions/status";

export const dynamic = "force-dynamic";

export const metadata = buildPublicPageMetadata({
  title: "Submit a skill | SkillMap",
  description: "Queue an exact public GitHub skill version for bounded static inspection and operator review.",
  path: "/submit"
});

export default async function SubmitPage({
  searchParams
}: {
  searchParams: Promise<{
    status?: string | string[];
    field?: string | string[];
    submission?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const status = parseSubmitStatus(params.status);
  const submissionId = parseSubmissionPublicId(params.submission);
  const field = typeof params.field === "string" && /^[a-z][A-Za-z]{0,39}$/.test(params.field)
    ? params.field
    : null;
  const authState = await getSubmitAuthState();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <CatalogHeader account={authState === "authenticated"} />
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Free curated trust alpha</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Submit one exact skill version.</h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            Queue a public GitHub source coordinate for bounded static inspection and operator review. Submission does not execute repository content, publish a listing, or create a current grade.
          </p>
        </div>

        {status ? <SubmissionStatusNotice status={status} submissionId={submissionId} field={field} /> : null}

        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
          {authState === "authenticated" ? (
            <SubmissionForm requestId={randomUUID()} />
          ) : authState === "signed-out" ? (
            <section className="surface rounded-2xl p-6 sm:p-8" aria-labelledby="sign-in-to-submit">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary"><LockKeyhole className="h-5 w-5" /></div>
              <h2 id="sign-in-to-submit" className="mt-5 text-2xl font-semibold">Sign in before you queue a submission.</h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                GitHub sign-in gives the queue a verified account owner. Accounts and submissions are free; there is no billing or entitlement step.
              </p>
              <Link href="/sign-in?next=/submit" className="press mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-foreground px-5 text-sm font-semibold text-background hover:opacity-90">
                <Github className="h-4 w-4" /> Sign in with GitHub <ArrowRight className="h-4 w-4" />
              </Link>
            </section>
          ) : (
            <section className="rounded-2xl border border-warning/35 bg-warning/10 p-6 sm:p-8" role="status" aria-labelledby="submission-unavailable">
              <AlertTriangle className="h-6 w-6 text-warning" />
              <h2 id="submission-unavailable" className="mt-4 text-xl font-semibold">Submission service unavailable</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Hosted authentication or Supabase cannot be verified in this environment. No fixture account or local bypass has been substituted, and no submission was created.
              </p>
            </section>
          )}

          <SubmissionBoundary />
        </div>
      </div>
    </main>
  );
}

function SubmissionBoundary() {
  return (
    <aside className="min-w-0 rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"><ScanSearch className="h-5 w-5" /></span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Review boundary</p>
          <h2 className="mt-1 text-lg font-semibold">What happens next</h2>
        </div>
      </div>
      <ol className="mt-6 grid gap-5">
        {[
          ["1", "Queued", "Only you can see the account-owned submission intent or withdraw it while it remains queued."],
          ["2", "Static inspection", "A constrained worker may fetch the exact public commit. Submitted instructions and scripts are never executed."],
          ["3", "Operator review", "Audit evidence, license disposition, and compatibility remain separate. Submission alone creates no listing or grade."]
        ].map(([step, title, body]) => (
          <li key={step} className="flex gap-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-primary/30 bg-primary/10 text-xs font-semibold text-primary">{step}</span>
            <div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{body}</p></div>
          </li>
        ))}
      </ol>
      <div className="mt-6 rounded-xl border border-border bg-muted/45 p-4">
        <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />Public source visibility is required, but it does not by itself prove redistribution permission or safety.</p>
      </div>
      <div className="mt-3 rounded-xl border border-border bg-muted/45 p-4">
        <p className="text-xs leading-5 text-muted-foreground"><strong className="text-foreground">Queue quota:</strong> each authenticated account may have at most 3 queued or processing submissions and create at most 10 submissions in a rolling 24-hour window. Withdrawn and completed rows still count toward the rolling creation limit.</p>
      </div>
      <Link href="/account/submissions" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">View your submissions <ArrowRight className="h-4 w-4" /></Link>
    </aside>
  );
}

function SubmissionStatusNotice({ status, submissionId, field }: { status: SubmitStatus; submissionId: string | null; field: string | null }) {
  const messages: Record<SubmitStatus, { title: string; body: string; tone: string }> = {
    "auth-unavailable": { title: "Authentication could not be verified", body: "No submission was created. Try again after the hosted auth service recovers.", tone: "border-warning/35 bg-warning/10" },
    duplicate: { title: "That exact source is already in your queue", body: submissionId ? `Existing submission ${submissionId} remains the source of truth.` : "Open your submissions to inspect the existing request.", tone: "border-warning/35 bg-warning/10" },
    "idempotency-conflict": { title: "Request ID already used", body: "No second row was created. Reload this form to generate a new request ID, then verify the source coordinates before retrying.", tone: "border-warning/35 bg-warning/10" },
    invalid: { title: "Submission input was rejected", body: field ? `The ${humanizeField(field)} field was not canonical or exceeded its boundary. No database mutation occurred.` : "One or more fields were invalid. No database mutation occurred.", tone: "border-destructive/30 bg-destructive/10" },
    quota: { title: "Submission quota reached", body: "This account has 3 active submissions or already created 10 submissions in the rolling 24-hour window. No new row was created.", tone: "border-warning/35 bg-warning/10" },
    queued: { title: "Submission queued", body: "The account-owned request is queued for review; it is not public and has no current grade.", tone: "border-primary/30 bg-primary/10" },
    "service-unavailable": { title: "Submission service unavailable", body: "The request could not be confirmed, so SkillMap does not claim that a submission was created.", tone: "border-warning/35 bg-warning/10" }
  };
  const message = messages[status];
  return <div className={`mt-7 rounded-xl border p-4 ${message.tone}`} role="status"><p className="font-semibold">{message.title}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{message.body}</p></div>;
}

function humanizeField(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

async function getSubmitAuthState(): Promise<"authenticated" | "signed-out" | "unavailable"> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getClaims();
    return classifyVerifiedClaims(data, error).state;
  } catch (error) {
    if (!(error instanceof SupabaseConfigurationError)) throw error;
    return "unavailable";
  }
}
