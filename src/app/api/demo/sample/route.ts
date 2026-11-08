import { handle, json } from "@/lib/server/http";
import { loadSampleHistory } from "@/lib/server/runner";
import { currentWorkspace } from "@/lib/server/session";

/** Offline demo: populate an empty workspace via real simulated agent runs. */
export async function POST() {
  return handle(async () => json(await loadSampleHistory(await currentWorkspace()), 201));
}
