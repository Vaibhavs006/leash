import { connection } from "next/server";
import { Suspense } from "react";
import { Dashboard } from "@/components/Dashboard";
import { noticeFromParams } from "@/components/format";
import { currentWorkspace } from "@/lib/server/session";
import { workspaceState, type WorkspaceState } from "@/lib/server/state";

async function DashboardWithState({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  await connection(); // per-visitor data: render at request time only
  let initialState: WorkspaceState | null = null;
  try {
    initialState = await workspaceState(await currentWorkspace());
  } catch (e) {
    // Client will retry and show a readable error.
    console.error("[page] initial state failed", e);
  }
  // Dates must cross the server/client boundary as plain JSON.
  const plain = initialState ? (JSON.parse(JSON.stringify(initialState)) as WorkspaceState) : null;
  return <Dashboard initialNotice={noticeFromParams(await searchParams)} initialState={plain} />;
}

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <DashboardWithState searchParams={searchParams} />
    </Suspense>
  );
}
