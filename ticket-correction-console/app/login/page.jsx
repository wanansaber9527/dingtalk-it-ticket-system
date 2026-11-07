import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import {
  SESSION_COOKIE_NAME,
  verifySessionToken
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const cookieStore = await cookies();
  const session = verifySessionToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (session) redirect("/");
  return <LoginForm />;
}
