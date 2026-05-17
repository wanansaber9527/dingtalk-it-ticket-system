// 中文注释：管理员维护接口，支持将钉钉用户加入管理员名单。
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok, parseJson } from "@/src/lib/http";
import { UserService, type PersonnelInput } from "@/src/server/services/userService";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser(request);
    const body = await parseJson<PersonnelInput>(request);
    const service = new UserService();
    return ok(await service.addAdmin(body, user), { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
