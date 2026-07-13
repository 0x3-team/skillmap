import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { getOptionalSiteUrl } from "@/lib/metadata";
import { isPublicIndexingEnabled } from "@/lib/security/policy";
import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap"
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap"
});

const siteUrl = getOptionalSiteUrl();

export const metadata: Metadata = {
  metadataBase: siteUrl ?? undefined,
  title: "SkillMap | Auditable Skill Library and Local Router",
  description:
    "Inspect hosted skill evidence, save useful skills, and route compact policy-backed advice without flooding the agent prompt.",
  ...(siteUrl
    ? {
        alternates: { canonical: new URL("/", siteUrl) },
        openGraph: {
          type: "website" as const,
          siteName: "SkillMap",
          title: "SkillMap | Auditable Skill Library and Local Router",
          description: "Inspect hosted skill evidence, save useful skills, and route compact policy-backed advice without flooding the agent prompt.",
          url: siteUrl
        },
        twitter: {
          card: "summary" as const,
          title: "SkillMap | Auditable Skill Library and Local Router",
          description: "Inspect hosted skill evidence, save useful skills, and route compact policy-backed advice without flooding the agent prompt."
        }
      }
    : {}),
  robots: isPublicIndexingEnabled()
    ? { index: true, follow: true }
    : {
        index: false,
        follow: false,
        noarchive: true,
        nosnippet: true,
        noimageindex: true,
        nocache: true,
        googleBot: {
          index: false,
          follow: false,
          noarchive: true,
          nosnippet: true,
          noimageindex: true
        }
      }
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Nonce extraction and automatic framework script/style nonce application
  // require request-time rendering in Next.js 16.
  await connection();
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <noscript>
          <div className="mx-auto my-8 max-w-2xl rounded-xl border border-warning/35 bg-warning/10 p-6 text-foreground" role="status">
            <h1 className="text-xl font-semibold">JavaScript is required for hosted SkillMap workflows.</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">The online catalog uses streamed server components and cannot expose authenticated save, submit, report, or account controls safely without JavaScript. The local CLI remains available independently.</p>
          </div>
        </noscript>
        {children}
      </body>
    </html>
  );
}
