import { LandingPage } from "@/components/skillmap/landing-page";
import { resolveHostedAccountState } from "@/lib/auth/account-state.server";
import { getReleaseStage } from "@/lib/security/policy";

export default async function Page() {
  return <LandingPage releaseStage={getReleaseStage()} accountState={await resolveHostedAccountState()} />;
}
