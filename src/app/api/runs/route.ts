import { z } from "zod";
import { handle, json } from "@/lib/server/http";
import { startAgentRun } from "@/lib/server/runner";
import { currentWorkspace } from "@/lib/server/session";

const Body = z.object({
  mandateId: z.string().uuid(),
  goal: z.string().trim().min(5).max(500),
  redTeam: z.boolean().default(false),
});

export async function POST(req: Request) {
  return handle(async () => {
    const ws = await currentWorkspace();
    const { mandateId, goal, redTeam } = Body.parse(await req.json());
    const run = await startAgentRun(ws, mandateId, goal, redTeam);
    return json(run, 202);
  });
}
