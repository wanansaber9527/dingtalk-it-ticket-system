import { getCurrentUser } from "@/src/server/auth";
import { fail, ok } from "@/src/lib/http";
import { DirectorySyncService } from "@/src/server/services/directorySyncService";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(request);
    const { id } = await context.params;
    return ok(await new DirectorySyncService().logDetail(id, user));
  } catch (error) { return fail(error); }
}
