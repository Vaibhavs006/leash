import { z } from "zod";
import { handle, json } from "@/lib/server/http";
import { simulateHijack } from "@/lib/server/runner";
import { currentWorkspace } from "@/lib/server/session";

const Body = z.object({ mandateId: z.string().uuid() });

export async function POST(req: Request) {
  return handle(async () => {
    const ws = await currentWorkspace();
    const { mandateId } = Body.parse(await req.json());
    return json(await simulateHijack(ws, mandateId), 201);
  });
}
