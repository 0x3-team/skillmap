import type { DeviceConfirmationActionState } from "./actions";

export type ConfirmationViewState =
  | "idle"
  | "review-error"
  | "review"
  | "decision-error"
  | "approved"
  | "denied"
  | "expired";

export function confirmationViewState(
  review: DeviceConfirmationActionState,
  decision: DeviceConfirmationActionState
): ConfirmationViewState {
  if (decision.status === "approved" || decision.status === "denied" || decision.status === "expired") {
    return decision.status;
  }
  if (review.status === "reviewed") {
    return decision.status === "unavailable" ? "decision-error" : "review";
  }
  return review.status === "unavailable" ? "review-error" : "idle";
}
