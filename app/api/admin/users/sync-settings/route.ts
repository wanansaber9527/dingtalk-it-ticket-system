import { getCurrentUser } from "@/src/server/auth";
import { fail, ok, parseJson } from "@/src/lib/http";
import { DirectorySyncService } from "@/src/server/services/directorySyncService";

export async function GET(request: Request) {
  try { return ok(await new DirectorySyncService().settings(await getCurrentUser(request))); }
  catch (error) { return fail(error); }
}

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser(request);
    return ok(await new DirectorySyncService().updateSettings(await parseJson(request), user));
  } catch (error) { return fail(error); }
}
