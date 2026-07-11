import Link from "next/link";
import { Bookmark, LogOut } from "lucide-react";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CatalogHeader } from "@/components/skillmap/catalog-header";
import { CatalogUnavailable } from "@/components/skillmap/catalog-states";
import { signOut } from "@/app/sign-in/actions";
import { unsaveSkill } from "@/app/account/actions";
import { shouldRedirectForAuthError } from "@/lib/auth/errors";
import { listSavedSkills } from "@/lib/registry/repository.server";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  let supabase: SupabaseClient<Database>;
  try {
    supabase = await createSupabaseServerClient();
  } catch (error) {
    if (!(error instanceof SupabaseConfigurationError)) throw error;
    return <AccountUnavailable />;
  }
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (typeof userId !== "string") {
    if (shouldRedirectForAuthError(error)) redirect("/sign-in?next=/account");
    return <AccountUnavailable />;
  }

  const accountData = await loadAccountData(supabase, userId);
  if (!accountData) return <AccountUnavailable />;
  const { profile, savedSkills } = accountData;

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
          <form action={signOut}>
            <button type="submit" className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-semibold hover:bg-accent">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </form>
        </div>

        <section className="py-8" id="saved">
          {savedSkills.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/60 p-8 text-center">
              <Bookmark className="mx-auto h-6 w-6 text-primary" />
              <h2 className="mt-4 text-lg font-semibold">No saved skills yet</h2>
              <p className="mt-2 text-sm text-muted-foreground">Browse the public library and save the skills worth returning to.</p>
              <Link href="/skills" className="mt-5 inline-flex h-10 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground">Browse library</Link>
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
        </section>
      </div>
    </main>
  );
}

async function loadAccountData(supabase: SupabaseClient<Database>, userId: string) {
  try {
    const [profileResult, savedSkills] = await Promise.all([
      supabase.from("profiles").select("created_at").eq("user_id", userId).maybeSingle(),
      listSavedSkills(supabase)
    ]);
    if (profileResult.error) return null;
    return { profile: profileResult.data, savedSkills };
  } catch {
    return null;
  }
}

function AccountUnavailable() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <CatalogHeader />
      <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6"><CatalogUnavailable /></section>
    </main>
  );
}
