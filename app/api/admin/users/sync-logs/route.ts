import { getCurrentUser } from "@/src/server/auth";
import { fail, ok } from "@/src/lib/http";
import { DirectorySyncService } from "@/src/server/services/directorySyncService";

export async function GET(request: Request) {
  try { return ok(await new DirectorySyncService().logs(new URL(request.url).searchParams, await getCurrentUser(request))); }
  catch (error) { return fail(error); }
}
