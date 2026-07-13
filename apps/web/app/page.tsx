import { LandingPage } from "@/components/skillmap/landing-page";
import { getReleaseStage } from "@/lib/security/policy";

export default function Page() {
  return <LandingPage releaseStage={getReleaseStage()} />;
}
