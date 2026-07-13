import { cookies } from "next/headers";
import Link from "next/link";
import { Github, LockKeyhole } from "lucide-react";
import { CatalogHeader } from "@/components/skillmap/catalog-header";
import { safeNextPath } from "@/lib/auth/paths";
import { SupabaseConfigurationError, getPublicSupabaseConfig } from "@/lib/supabase/config";
import { signInWithGitHub } from "@/app/sign-in/actions";
import {
  ACCOUNT_DELETION_FLASH_COOKIE,
  parseAccountDeletionFlash
} from "@/lib/account/deletion-flash";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams
}: {
  searchParams: Promise<{
    next?: string | string[];
    error?: string | string[];
    status?: string | string[];
    accountFlash?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : undefined);
  const deletionFlash = parseAccountDeletionFlash(
    (await cookies()).get(ACCOUNT_DELETION_FLASH_COOKIE)?.value,
    params.accountFlash
  );
  let configured = true;
  try {
    getPublicSupabaseConfig();
  } catch (error) {
    if (!(error instanceof SupabaseConfigurationError)) throw error;
    configured = false;
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <CatalogHeader />
      <section className="mx-auto grid max-w-5xl gap-8 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Free account</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Save skills and track exact-source submissions.</h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-muted-foreground">
            SkillMap accounts are free at launch. The application stores your profile, saved-skill list, and account-owned submission intents, while Supabase Auth retains the identity and session data described in the privacy boundary. Billing and entitlements are not part of this release.
          </p>
        </div>
        <div className="surface rounded-2xl p-6 sm:p-8">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
            <LockKeyhole className="h-5 w-5" />
          </div>
          <h2 className="mt-5 text-xl font-semibold">Continue with GitHub</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Supabase handles the OAuth session. SkillMap never asks for your GitHub password.
          </p>
          {params.error ? (
            <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
              Sign-in could not be completed. Please try again.
            </p>
          ) : null}
          {deletionFlash ? (
            <p className="mt-4 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-foreground" role="status">
              Your SkillMap account was deleted and this browser session was cleared.
            </p>
          ) : null}
          {params.status === "account-delete-unconfirmed" ? (
            <p className="mt-4 rounded-lg border border-warning/35 bg-warning/10 p-3 text-sm text-foreground" role="status">
              Account deletion could not be confirmed. Sign in to verify whether the account still exists before retrying. SkillMap does not claim that account data or a browser session changed.
            </p>
          ) : null}
          {configured ? (
            <form action={signInWithGitHub} className="mt-6">
              <input type="hidden" name="next" value={next} />
              <button type="submit" className="press inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 text-sm font-semibold text-background hover:opacity-90">
                <Github className="h-4 w-4" />
                Sign in with GitHub
              </button>
            </form>
          ) : (
            <div className="mt-6 rounded-lg border border-warning/35 bg-warning/10 p-4 text-sm leading-6 text-foreground" role="status">
              Hosted authentication is not configured in this environment. No fixture account or local bypass has been substituted.
            </div>
          )}
          <p className="mt-5 text-xs leading-5 text-muted-foreground">
            By continuing, you agree to the <Link href="/privacy" className="underline hover:text-foreground">privacy boundary</Link> and <Link href="/security" className="underline hover:text-foreground">security model</Link>.
          </p>
        </div>
      </section>
    </main>
  );
}
