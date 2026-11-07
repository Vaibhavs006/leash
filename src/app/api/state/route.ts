import { connection } from "next/server";
import { handle, json } from "@/lib/server/http";
import { currentWorkspace } from "@/lib/server/session";
import { workspaceState } from "@/lib/server/state";


export async function GET() {
  await connection(); // request-time only; never prerender
  return handle(async () => json(await workspaceState(await currentWorkspace())));
}
