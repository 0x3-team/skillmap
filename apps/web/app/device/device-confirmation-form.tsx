"use client";

import { useActionState, useState } from "react";
import {
  decideDeviceConfirmation,
  reviewDeviceConfirmation,
  type DeviceConfirmationActionState
} from "./actions";
import { confirmationViewState } from "./confirmation-view-state";
import { scopeLabel, type DeviceConfirmationReview } from "@/lib/device-auth/confirmation-contracts.server";

const INITIAL_STATE: DeviceConfirmationActionState = { status: "idle" };

export function DeviceConfirmationForm() {
  const [reviewState, reviewAction, reviewPending] = useActionState(reviewDeviceConfirmation, INITIAL_STATE);
  const [decisionState, decisionAction, decisionPending] = useActionState(decideDeviceConfirmation, INITIAL_STATE);
  const [userCode, setUserCode] = useState("");

  const viewState = confirmationViewState(reviewState, decisionState);

  if (viewState === "approved" || viewState === "denied" || viewState === "expired") {
    return <TerminalScreen status={viewState} />;
  }

  if (reviewState.status === "reviewed") {
    return (
      <ReviewCard
        review={reviewState}
        action={decisionAction}
        pending={decisionPending}
        error={viewState === "decision-error" ? decisionState : null}
      />
    );
  }

  return (
    <form action={reviewAction} className="mt-8 space-y-5" noValidate>
      <div>
        <label htmlFor="device-user-code" className="block text-sm font-semibold">Enter the code shown in your terminal</label>
        <p id="device-user-code-help" className="mt-2 text-sm leading-6 text-muted-foreground">Use the five-and-five code, including the hyphen. It is checked only for this confirmation request.</p>
        <input
          id="device-user-code"
          name="userCode"
          value={userCode}
          onChange={(event) => setUserCode(event.target.value.toUpperCase())}
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          maxLength={11}
          aria-describedby="device-user-code-help"
          className="mono mt-4 h-12 w-full rounded-xl border border-border bg-background px-4 text-center text-lg tracking-[0.18em] text-foreground outline-none ring-offset-2 focus:ring-2"
        />
      </div>
      <button type="submit" disabled={reviewPending} className="press inline-flex h-11 w-full items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:cursor-wait disabled:opacity-60">
        {reviewPending ? "Checking code…" : "Review device"}
      </button>
      {viewState === "review-error" ? <GenericConfirmationError /> : null}
    </form>
  );
}

function ReviewCard({
  review,
  action,
  pending,
  error
}: {
  review: DeviceConfirmationReview;
  action: (formData: FormData) => void;
  pending: boolean;
  error: DeviceConfirmationActionState | null;
}) {
  return (
    <section aria-labelledby="device-review-heading" className="mt-8 space-y-6">
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Review request</p>
        <h2 id="device-review-heading" className="mt-3 text-2xl font-semibold">{review.device.name}</h2>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-3">
          <div><dt className="text-muted-foreground">Platform</dt><dd className="mt-1 font-medium">{review.device.platform}</dd></div>
          <div><dt className="text-muted-foreground">Connector version</dt><dd className="mt-1 font-medium">{review.device.connector_version}</dd></div>
          <div><dt className="text-muted-foreground">Access requested</dt><dd className="mt-1 font-medium">{review.device.scopes.length} scope{review.device.scopes.length === 1 ? "" : "s"}</dd></div>
        </dl>
        <ul className="mt-5 grid gap-2 text-sm text-muted-foreground" aria-label="Requested access">
          {review.device.scopes.map((scope) => <li key={scope} className="rounded-lg bg-muted/60 px-3 py-2">{scopeLabel(scope)}</li>)}
        </ul>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">Approve only if this is the device you just paired. The decision is bound to your signed-in account and can be used once.</p>
      {error ? <GenericConfirmationError /> : null}
      <form action={action} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="confirmationHandle" value={review.handle} />
        <input type="hidden" name="confirmationRevision" value={String(review.revision)} />
        <button type="submit" name="decision" value="deny" disabled={pending} className="press inline-flex h-11 items-center justify-center rounded-full border border-destructive/35 px-5 text-sm font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-60">Deny</button>
        <button type="submit" name="decision" value="approve" disabled={pending} className="press inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">{pending ? "Saving…" : "Approve"}</button>
      </form>
    </section>
  );
}

function TerminalScreen({ status }: { status: "approved" | "denied" | "expired" }) {
  const copy = status === "approved"
    ? ["Device approved", "Return to your terminal to finish signing in."]
    : status === "denied"
      ? ["Device denied", "Return to your terminal and start again if needed."]
      : ["This request has expired", "Return to your terminal and start a new pairing."];
  return <section role="status" aria-live="polite" className="mt-8 rounded-2xl border border-border bg-card p-6"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Finished</p><h2 className="mt-3 text-2xl font-semibold">{copy[0]}</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">{copy[1]}</p></section>;
}

function GenericConfirmationError() {
  return <p role="alert" className="rounded-xl border border-warning/35 bg-warning/10 p-4 text-sm leading-6 text-foreground">That code or confirmation is no longer available. Check the terminal and start a new pairing if needed.</p>;
}
