import Link from "next/link";
import { Bookmark, Download, FileClock, FileWarning, LogOut, Trash2 } from "lucide-react";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CatalogHeader } from "@/components/skillmap/catalog-header";
import { CatalogUnavailable } from "@/components/skillmap/catalog-states";
import { signOut } from "@/app/sign-in/actions";
import { deleteMyAccount } from "@/app/account/data-actions";
import { unsaveSkill } from "@/app/account/actions";
import { classifyVerifiedClaims } from "@/lib/auth/errors";
import { ACCOUNT_DELETION_CONFIRMATION } from "@/lib/account/deletion.server";
import { CatalogDataError, CatalogInputError, CatalogQueryError } from "@/lib/registry/errors";
import { listSavedSkills } from "@/lib/registry/repository.server";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AccountPage({
  searchParams
}: {
  searchParams: Promise<{ cursor?: string | string[]; error?: string | string[]; accountStatus?: string | string[] }>;
}) {
  const params = await searchParams;
  if (params.error === "auth-unavailable") return <AccountUnavailable />;
  const cursor = typeof params.cursor === "string" ? params.cursor : null;

  let supabase: SupabaseClient<Database>;
  try {
    supabase = await createSupabaseServerClient();
  } catch (error) {
    if (!(error instanceof SupabaseConfigurationError)) throw error;
    return <AccountUnavailable />;
  }
  const { data, error } = await supabase.auth.getClaims();
  const auth = classifyVerifiedClaims(data, error);
  if (auth.state !== "authenticated") {
    if (auth.state === "signed-out") redirect("/sign-in?next=/account");
    return <AccountUnavailable />;
  }

  let accountData;
  try {
    accountData = await loadAccountData(supabase, auth.userId, cursor);
  } catch (error) {
    if (error instanceof CatalogInputError) return <InvalidSavedSkillsPage />;
    if (error instanceof CatalogQueryError || error instanceof CatalogDataError) return <AccountUnavailable />;
    throw error;
  }
  if (!accountData) return <AccountUnavailable />;
  const { profile, savedPage } = accountData;
  const savedSkills = savedPage.items;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <CatalogHeader account />
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="flex flex-col gap-5 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Free account</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">Your saved skills</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              {profile?.created_at ? `Account active since ${new Date(profile.created_at).toLocaleDateString("en", { dateStyle: "medium" })}.` : "Account profile is active."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/account/submissions" className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-semibold hover:bg-accent"><FileClock className="h-4 w-4" /> Submissions</Link>
            <Link href="/account/reports" className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-semibold hover:bg-accent"><FileWarning className="h-4 w-4" /> Reports</Link>
            <a href="/account/export" className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-semibold hover:bg-accent"><Download className="h-4 w-4" /> Export JSON</a>
            <form action={signOut}>
              <button type="submit" className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-semibold hover:bg-accent">
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </form>
          </div>
        </div>

        <section className="py-8" id="saved">
          {savedSkills.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/60 p-8 text-center">
              <Bookmark className="mx-auto h-6 w-6 text-primary" />
              <h2 className="mt-4 text-lg font-semibold">{cursor ? "No saved skills on this page" : "No saved skills yet"}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {cursor ? "The saved list changed or this page is now empty. Return to the first page." : "Browse the public library and save the skills worth returning to."}
              </p>
              <Link href={cursor ? "/account#saved" : "/skills"} className="mt-5 inline-flex h-10 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground">
                {cursor ? "Return to first page" : "Browse library"}
              </Link>
            </div>
          ) : (
            <div className="grid gap-3">
              {savedSkills.map((skill) => (
                <article key={skill.skillId} className="grid gap-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{skill.publisher.handle}</p>
                    <Link href={`/skills/${skill.publisher.handle}/${skill.slug}`} className="mt-1 block text-lg font-semibold hover:text-primary">{skill.displayName}</Link>
                    <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">{skill.summary}</p>
                  </div>
                  <form action={unsaveSkill}>
                    <input type="hidden" name="skillId" value={skill.skillId} />
                    <button type="submit" className="inline-flex h-9 items-center rounded-full border border-border px-3 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground">Remove</button>
                  </form>
                </article>
              ))}
            </div>
          )}
          {(cursor || savedPage.hasMore) && (
            <nav aria-label="Saved skills pages" className="mt-6 flex flex-wrap gap-3">
              {cursor && <Link href="/account#saved" className="inline-flex h-9 items-center rounded-full border border-border px-3 text-xs font-semibold hover:bg-accent">First page</Link>}
              {savedPage.nextCursor && <Link href={`/account?cursor=${encodeURIComponent(savedPage.nextCursor)}#saved`} className="inline-flex h-9 items-center rounded-full border border-border px-3 text-xs font-semibold hover:bg-accent">Next saved skills</Link>}
            </nav>
          )}
        </section>

        <section className="scroll-mt-20 border-t border-border py-8" id="account-data" aria-labelledby="account-data-heading">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Data controls</p>
            <h2 id="account-data-heading" className="mt-2 text-xl font-semibold">Export or delete account data</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">The bounded export contains your SkillMap profile, saved skill IDs, owner-filtered submission projection, and owner-filtered listing reports. It does not include Supabase provider secrets or private operator evidence.</p>
          </div>
          {params.accountStatus === "delete-confirmation" ? <p className="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" role="alert">Type the exact confirmation phrase before deleting the account. No data was changed.</p> : null}
          {params.accountStatus === "delete-unavailable" ? <p className="mt-5 rounded-xl border border-warning/35 bg-warning/10 p-4 text-sm text-foreground" role="status">Account deletion could not be confirmed. The session remains active and SkillMap does not claim that data was deleted.</p> : null}
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-5">
              <Download className="h-5 w-5 text-primary" />
              <h3 className="mt-3 font-semibold">Download account JSON</h3>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">Generated on demand, owner-filtered, capped, and returned with private no-store headers.</p>
              <a href="/account/export" className="mt-4 inline-flex h-9 items-center rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground">Export JSON</a>
            </div>
            <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-5">
              <Trash2 className="h-5 w-5 text-destructive" />
              <h3 className="mt-3 font-semibold">Delete SkillMap account</h3>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">Deletes the authenticated account, profile, saved IDs, submissions, submission evidence, and account-owned listing reports. Published catalog metadata may remain, but its submission-backed evidence is detached and reset. This clears the current browser session; already-issued tokens on other devices may remain cryptographically valid until expiry, without the deleted account rows. Source repositories and provider backups are outside this RPC.</p>
              <form action={deleteMyAccount} className="mt-4">
                <label htmlFor="delete-account-confirmation" className="block text-xs font-semibold">Type “{ACCOUNT_DELETION_CONFIRMATION}”</label>
                <input id="delete-account-confirmation" name="confirmation" type="text" required autoComplete="off" maxLength={ACCOUNT_DELETION_CONFIRMATION.length} placeholder={ACCOUNT_DELETION_CONFIRMATION} className="mt-2 h-9 w-full rounded-lg border border-destructive/25 bg-background px-3 text-xs text-foreground" />
                <button type="submit" className="mt-3 inline-flex h-9 items-center rounded-full border border-destructive/35 px-4 text-xs font-semibold text-destructive hover:bg-destructive/10">Delete account permanently</button>
              </form>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

async function loadAccountData(supabase: SupabaseClient<Database>, userId: string, cursor: string | null) {
  const [profileResult, savedPage] = await Promise.all([
    supabase.from("profiles").select("created_at").eq("user_id", userId).maybeSingle(),
    listSavedSkills(supabase, cursor)
  ]);
  if (profileResult.error) return null;
  return { profile: profileResult.data, savedPage };
}

function AccountUnavailable() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <CatalogHeader />
      <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6"><CatalogUnavailable /></section>
    </main>
  );
}

function InvalidSavedSkillsPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <CatalogHeader account />
      <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <h1 className="text-xl font-semibold">That saved-skills page link is invalid.</h1>
          <p className="mt-2 text-sm text-muted-foreground">Return to the first page of your saved skills. No account data was changed.</p>
          <Link href="/account#saved" className="mt-5 inline-flex h-10 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground">Return to saved skills</Link>
        </div>
      </section>
    </main>
  );
}
