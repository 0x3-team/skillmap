import { connection } from "next/server";
import { DashboardClient } from "@/components/skillmap/dashboard-client";
import { loadDashboardPageData } from "@/lib/dashboard-data";

export async function DashboardPage() {
  await connection();
  const data = await loadDashboardPageData();
  return <DashboardClient data={data} />;
}
