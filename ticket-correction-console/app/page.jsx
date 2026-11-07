import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CorrectionConsole } from "@/components/CorrectionConsole";
import {
  SESSION_COOKIE_NAME,
  verifySessionToken
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function CorrectionPage() {
  const cookieStore = await cookies();
  const session = verifySessionToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!session) redirect("/login");

  return (
    <CorrectionConsole
      session={{
        username: session.sub,
        csrf: session.csrf,
        expiresAt: new Date(session.exp).toISOString()
      }}
    />
  );
}
