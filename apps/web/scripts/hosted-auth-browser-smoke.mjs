import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const baseUrl = process.env.SKILLMAP_WEB_BASE_URL ?? "http://127.0.0.1:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
  throw new Error("Local Supabase URL, publishable key, and service-role key are required for the authenticated smoke test.");
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const email = `hosted-auth-smoke-${Date.now()}@skillmap.invalid`;
const password = `Local-smoke-${crypto.randomUUID()}!`;
const { data: created, error: createError } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true
});
if (createError || !created.user) throw createError ?? new Error("Synthetic local user was not created.");

let browser;
try {
  const cookieJar = new Map();
  const auth = createServerClient(supabaseUrl, publishableKey, {
    db: { schema: "api" },
    cookies: {
      getAll: () => [...cookieJar.values()],
      setAll: (entries) => {
        for (const entry of entries) cookieJar.set(entry.name, entry);
      }
    }
  });
  const { data: signedIn, error: signInError } = await auth.auth.signInWithPassword({ email, password });
  if (signInError || !signedIn.user) throw signInError ?? new Error("Synthetic local user was not authenticated.");

  const { error: profileError } = await auth.from("profiles").insert({ user_id: signedIn.user.id });
  if (profileError) throw profileError;

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  await context.addCookies([...cookieJar.values()].map(({ name, value, options = {} }) => ({
    name,
    value,
    url: baseUrl,
    httpOnly: options.httpOnly ?? false,
    secure: false,
    sameSite: options.sameSite === "strict" ? "Strict" : options.sameSite === "none" ? "None" : "Lax"
  })));

  const page = await context.newPage();
  const diagnostics = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      diagnostics.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(new URL("/skills", baseUrl).toString(), { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Skill library" }).waitFor();
  const mobileWidth = await page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  if (mobileWidth.scroll > mobileWidth.inner) {
    throw new Error(`Hosted catalog overflows at 390px (${mobileWidth.scroll}px > ${mobileWidth.inner}px).`);
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(new URL("/account", baseUrl).toString(), { waitUntil: "networkidle" });
  if (!(await page.getByRole("heading", { name: "Your saved skills" }).isVisible())) {
    throw new Error(`Authenticated account route failed at ${page.url()}.`);
  }
  await page.getByRole("heading", { name: "No saved skills yet" }).waitFor();

  await page.goto(new URL("/skills/0x3-team/skill-audit", baseUrl).toString(), { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Save skill" }).click();
  await page.getByRole("button", { name: "Remove from saved" }).waitFor();

  await page.goto(new URL("/account", baseUrl).toString(), { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Skill Audit" }).waitFor();
  await page.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("heading", { name: "No saved skills yet" }).waitFor();

  if (diagnostics.length > 0) throw new Error(`Authenticated browser diagnostics:\n${diagnostics.join("\n")}`);
  await context.close();
  process.stdout.write(`${JSON.stringify({
    result: "pass",
    account: "authenticated",
    save: "passed",
    savedProjection: "passed",
    unsave: "passed",
    mobileNavigationName: "passed",
    mobileOverflow: "passed",
    diagnostics: 0
  })}\n`);
} finally {
  await browser?.close().catch(() => undefined);
  const { error: deleteError } = await admin.auth.admin.deleteUser(created.user.id);
  if (deleteError) throw deleteError;
}
