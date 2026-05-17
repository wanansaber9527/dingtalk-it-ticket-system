// 中文注释：执行人员维护接口，支持将钉钉用户加入 IT 执行人员名单。
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok, parseJson } from "@/src/lib/http";
import { UserService, type PersonnelInput } from "@/src/server/services/userService";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser(request);
    const body = await parseJson<PersonnelInput>(request);
    const service = new UserService();
    return ok(await service.addExecutor(body, user), { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
