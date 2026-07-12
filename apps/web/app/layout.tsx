import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import type { ReactNode } from "react";
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

export const metadata: Metadata = {
  title: "SkillMap | Auditable Skill Library and Local Router",
  description:
    "Inspect hosted skill evidence, save useful skills, and route compact policy-backed advice without flooding the agent prompt.",
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
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
