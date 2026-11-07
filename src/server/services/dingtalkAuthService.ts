// 中文注释：业务服务层，封装工单系统核心业务规则和数据操作。
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/src/lib/prisma";
import { DingTalkClient } from "@/src/server/dingtalk/DingTalkClient";
import { AppError } from "@/src/lib/http";
import { PersonnelIdentityService } from "@/src/server/services/personnelIdentityService";
import { assertAuthConfiguration } from "@/src/server/auth-session";

export class DingTalkAuthService {
  constructor(
    private readonly prisma: PrismaClient = defaultPrisma,
    private readonly dingtalkClient = new DingTalkClient()
  ) {}

  async loginByCode(code: string) {
    assertAuthConfiguration();
    if (typeof code !== "string" || !code.trim() || code.length > 2048) throw new AppError(400, "INVALID_AUTH_CODE", "缺少有效的钉钉免登 code");
    const observedAt = new Date();
    const userId = await this.dingtalkClient.getUserIdByAuthCode(code);
    const detail = await this.dingtalkClient.getUserDetail(userId);
    if ((detail.userid || detail.userId) !== userId) throw new AppError(502, "DINGTALK_IDENTITY_MISMATCH", "钉钉用户详情与免登身份不一致");
    const department = await this.getSafeDepartmentInfo(detail);

    const { user } = await new PersonnelIdentityService(this.prisma).upsertDirectoryPerson({
      dingtalkUserId: userId, name: detail.name, unionId: detail.unionid || detail.unionId,
      mobile: detail.mobile, departmentId: department.departmentId, departmentName: department.departmentName,
      position: detail.position || detail.title, avatar: detail.avatar
    }, { source: "LOGIN", now: observedAt });
    if (user.status !== "ACTIVE" || user.manuallyDisabled || user.employmentStatus !== "ACTIVE") throw new AppError(403, "USER_DISABLED", "当前用户已被禁用");
    return user;
  }

  private async getSafeDepartmentInfo(detail: Awaited<ReturnType<DingTalkClient["getUserDetail"]>>) {
    try {
      return await this.dingtalkClient.getUserDepartmentInfo(detail);
    } catch (error) {
      // 中文注释：部门详情权限未开通时不能阻断免登，先保留用户身份，后续开通权限后再补齐部门。
      console.error("钉钉部门信息获取失败，已降级为空部门：", error instanceof Error ? error.message : error);
      return {
        departmentId: detail.dept_id_list?.[0] ? String(detail.dept_id_list[0]) : "",
        departmentName: detail.department?.[0] || ""
      };
    }
  }
}
