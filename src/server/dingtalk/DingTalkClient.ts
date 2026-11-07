// 中文注释：钉钉集成封装，集中处理钉钉开放平台身份、通讯录和工作通知。
import { isDingTalkMockEnabled } from "@/src/server/auth-config";
import { readFile } from "fs/promises";
type FetchOptions = {
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
  accessToken?: string;
};

type DingTalkOapiResponse<T> = {
  errcode?: number;
  errmsg?: string;
  result?: T;
  access_token?: string;
  expires_in?: number;
};

type DingTalkAccessTokenResponse = {
  access_token?: string;
  accessToken?: string;
  expires_in?: number;
  expireIn?: number;
};

export type DingTalkUserDetail = {
  userid: string;
  userId?: string;
  name: string;
  mobile?: string;
  avatar?: string;
  title?: string;
  dept_id_list?: Array<string | number>;
  department?: string[];
  position?: string;
  unionid?: string;
  unionId?: string;
};

type DingTalkDepartmentDetail = {
  dept_id?: number;
  name?: string;
};

export type DingTalkSelectableUser = {
  dingtalkUserId: string;
  name: string;
  departmentId?: string;
  departmentName?: string;
  position?: string;
  mobile?: string;
  avatar?: string;
  unionId?: string;
};

export type DingTalkDeparture = { externalUserId: string; occurredAt: Date; reason: string };

export type DingTalkWorkNoticeMessage =
  | {
      msgtype: "text";
      text: { content: string };
    }
  | {
      msgtype: "action_card";
      action_card: {
        title?: string;
        markdown: string;
        single_title?: string;
        single_url?: string;
      };
    }
  | {
      msgtype: "oa";
      oa: {
        message_url: string;
        pc_message_url?: string;
        head: {
          bgcolor: string;
          text: string;
        };
        status_bar?: {
          status_value: string;
          status_bg: string;
        };
        body: {
          title?: string;
          form?: Array<{ key: string; value: string }>;
          rich?: { num: string; unit: string };
          content?: string;
          image?: string;
          file_count?: string;
          author?: string;
        };
      };
    };

export type DingTalkInteractiveCardPayload = {
  cardTemplateId?: string;
  cardBizId: string;
  cardData: Record<string, unknown>;
  robotCode?: string;
  callbackUrl?: string;
};

function configuredUrl(value?: string) {
  return value && value.trim().length > 0 ? value.trim() : null;
}

function fillTemplate(template: string, params: Record<string, string>) {
  // 中文注释：钉钉接口路径保持可配置，通过模板占位符适配官方文档中的真实地址。
  return Object.entries(params).reduce(
    (current, [key, value]) => current.replaceAll(`{${key}}`, encodeURIComponent(value)),
    template
  );
}

export class DingTalkClient {
  private accessTokenCache?: { value: string; expiresAt: number };
  private openApiAccessTokenCache?: { value: string; expiresAt: number };

  private get mockEnabled() {
    // 中文注释：本地开发时使用 mock 身份和通知，避免没有钉钉参数时无法调试。
    return isDingTalkMockEnabled();
  }

  private async localDirectoryFixture(): Promise<{ people: DingTalkSelectableUser[]; departures: DingTalkDeparture[] } | null> {
    const file = process.env.DIRECTORY_SYNC_LOCAL_FIXTURE;
    if (!file) return null;
    if (process.env.NODE_ENV === "production" || process.env.ITDESK_LOCAL_ISOLATED !== "1" || !this.mockEnabled) throw new Error("人员同步测试数据仅允许在隔离本地模拟环境使用");
    const content = await readFile(file, "utf8");
    if (Buffer.byteLength(content) > 2_000_000) throw new Error("本地人员测试数据过大");
    const data = JSON.parse(content) as { people?: DingTalkSelectableUser[]; departures?: Array<{ externalUserId: string; occurredAt: string; reason?: string }> };
    if (!Array.isArray(data.people) || !Array.isArray(data.departures)) throw new Error("本地人员测试数据缺少 people / departures 数组");
    const departures = data.departures.map((entry) => {
      const occurredAt = new Date(entry.occurredAt);
      if (!entry.externalUserId || !Number.isFinite(occurredAt.getTime())) throw new Error("本地离职测试数据无效");
      return { externalUserId: entry.externalUserId, occurredAt, reason: entry.reason || "隔离本地测试离职记录" };
    });
    return { people: data.people, departures };
  }

  async getAccessToken() {
    if (this.mockEnabled) return "mock-access-token";
    if (this.accessTokenCache && this.accessTokenCache.expiresAt > Date.now() + 60_000) {
      return this.accessTokenCache.value;
    }

    const url = configuredUrl(process.env.DINGTALK_ACCESS_TOKEN_URL);
    const data: DingTalkAccessTokenResponse = url
      ? await this.fetchJson<DingTalkAccessTokenResponse>(url, {
          method: "POST",
          body: {
            clientId: process.env.DINGTALK_CLIENT_ID,
            clientSecret: process.env.DINGTALK_CLIENT_SECRET,
            corpId: process.env.DINGTALK_CORP_ID
          }
        })
      : await this.fetchOapi<DingTalkAccessTokenResponse>(
          `https://oapi.dingtalk.com/gettoken?${new URLSearchParams({
            appkey: this.requireEnv("DINGTALK_CLIENT_ID"),
            appsecret: this.requireEnv("DINGTALK_CLIENT_SECRET")
          }).toString()}`
        );
    const token = data.access_token || data.accessToken;
    if (!token) throw new Error("钉钉 access_token 响应缺少 token 字段");

    this.accessTokenCache = {
      value: token,
      expiresAt: Date.now() + (data.expires_in || 7200) * 1000
    };
    return token;
  }

  async getOpenApiAccessToken() {
    if (this.mockEnabled) return "mock-access-token";
    if (this.openApiAccessTokenCache && this.openApiAccessTokenCache.expiresAt > Date.now() + 60_000) {
      return this.openApiAccessTokenCache.value;
    }

    const data = await this.fetchJson<DingTalkAccessTokenResponse>("https://api.dingtalk.com/v1.0/oauth2/accessToken", {
      method: "POST",
      body: {
        appKey: this.requireEnv("DINGTALK_CLIENT_ID"),
        appSecret: this.requireEnv("DINGTALK_CLIENT_SECRET")
      }
    });
    const token = data.accessToken || data.access_token;
    if (!token) throw new Error("钉钉新版 access_token 响应缺少 accessToken 字段");

    this.openApiAccessTokenCache = {
      value: token,
      expiresAt: Date.now() + (data.expireIn || data.expires_in || 7200) * 1000
    };
    return token;
  }

  async getUserIdByAuthCode(code: string) {
    if (this.mockEnabled) return code || process.env.DEV_DINGTALK_USER_ID || "demo-super";
    const url = configuredUrl(process.env.DINGTALK_USERID_BY_CODE_URL);
    const accessToken = await this.getAccessToken();
    const data = url
      ? await this.fetchJson<{ userid?: string; userId?: string }>(url, {
          method: "POST",
          accessToken,
          body: { code }
        })
      : await this.fetchOapi<{ userid?: string; userId?: string }>(
          this.withAccessToken("https://oapi.dingtalk.com/topapi/v2/user/getuserinfo", accessToken),
          { code }
        );
    const userId = data.userid || data.userId;
    if (!userId) throw new Error("钉钉免登响应缺少 userid 字段");
    return userId;
  }

  async getUserDetail(userId: string) {
    if (this.mockEnabled) {
      const fixture = await this.localDirectoryFixture();
      if (fixture) {
        const person = fixture.people.find((entry) => entry.dingtalkUserId === userId);
        if (!person) throw new Error("本地测试通讯录不存在当前人员");
        return { userid: userId, name: person.name, unionid: person.unionId, mobile: person.mobile, avatar: person.avatar, title: person.position, department: person.departmentName ? [person.departmentName] : undefined, dept_id_list: person.departmentId ? [person.departmentId] : undefined } satisfies DingTalkUserDetail;
      }
      return {
        userid: userId,
        unionid: `mock-${userId}`,
        name: userId === "demo-handler" ? "李四" : userId === "demo-admin" ? "王五" : "钉钉用户",
        mobile: "13800000000",
        position: "员工",
        department: ["信息技术部"]
      } satisfies DingTalkUserDetail;
    }
    const accessToken = await this.getAccessToken();
    const template = configuredUrl(process.env.DINGTALK_USER_DETAIL_URL_TEMPLATE);
    if (template) {
      return this.fetchJson<DingTalkUserDetail>(fillTemplate(template, { userId }), {
        method: "GET",
        accessToken
      });
    }
    return this.fetchOapi<DingTalkUserDetail>(
      this.withAccessToken("https://oapi.dingtalk.com/topapi/v2/user/get", accessToken),
      { userid: userId, language: "zh_CN" }
    );
  }

  async getUserDepartmentInfo(user: DingTalkUserDetail) {
    const departmentName = user.department?.[0] || "";
    const departmentId = user.dept_id_list?.[0] ? String(user.dept_id_list[0]) : "";
    if (departmentName || this.mockEnabled) {
      return { departmentId, departmentName: departmentName || "信息技术部" };
    }

    if (!departmentId) return { departmentId, departmentName };
    const accessToken = await this.getAccessToken();
    const template = configuredUrl(process.env.DINGTALK_DEPARTMENT_DETAIL_URL_TEMPLATE);
    const data = template
      ? await this.fetchJson<{ name?: string }>(fillTemplate(template, { departmentId }), {
          method: "GET",
          accessToken
        })
      : await this.fetchOapi<{ name?: string }>(
          this.withAccessToken("https://oapi.dingtalk.com/topapi/v2/department/get", accessToken),
          { dept_id: Number(departmentId), language: "zh_CN" }
        );
    return { departmentId, departmentName: data.name || departmentName };
  }

  async listUsers(keyword?: string) {
    if (this.mockEnabled) {
      const fixture = await this.localDirectoryFixture();
      const people = fixture?.people || [
        { dingtalkUserId: "local-admin", name: "本地管理员", departmentName: "信息技术部", unionId: "mock-local-admin" },
        { dingtalkUserId: "local-handler", name: "陈工 · 测试", departmentName: "信息技术部", unionId: "mock-local-handler" },
        { dingtalkUserId: "local-handler-2", name: "林工 · 测试", departmentName: "信息技术部", unionId: "mock-local-handler-2" },
        { dingtalkUserId: "local-employee", name: "许宁 · 测试", departmentName: "运营部", unionId: "mock-local-employee" },
        { dingtalkUserId: "local-employee-2", name: "周然 · 测试", departmentName: "仓储部", unionId: "mock-local-employee-2" }
      ] satisfies DingTalkSelectableUser[];
      const search = keyword?.trim().toLowerCase();
      return search ? people.filter((person) => [person.name, person.departmentName, person.dingtalkUserId].some((value) => value?.toLowerCase().includes(search))) : people;
    }

    const accessToken = await this.getAccessToken();
    const normalized = await this.listOrganizationUsers(accessToken);
    const text = keyword?.trim().toLowerCase();
    if (!text) return normalized;
    return normalized.filter((item) =>
      [item.dingtalkUserId, item.name, item.departmentName, item.position]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(text))
    );
  }

  private async listOrganizationUsers(accessToken: string) {
    // 中文注释：同步通讯录必须递归读取全部部门和分页成员，避免只读取根部门导致误停用真实员工。
    const departmentIds = await this.listDepartmentIds(accessToken);
    const departments = await this.listDepartmentDetails(accessToken, departmentIds);
    const users = new Map<string, DingTalkUserDetail>();

    for (const departmentId of departmentIds) {
      for (const user of await this.listUsersByDepartment(accessToken, departmentId)) {
        const userId = user.userid || user.userId;
        if (!userId || !user.name?.trim()) throw new Error("钉钉通讯录返回不完整的人员身份，已停止本轮同步");
        if (!users.has(userId)) {
          users.set(userId, user);
        }
      }
    }

    return Array.from(users.values()).map((detail) => this.toSelectableUserFromDirectory(detail, departments));
  }

  private async listDepartmentIds(accessToken: string) {
    const visited = new Set<number>();
    const queue = [1];

    while (queue.length) {
      const departmentId = queue.shift();
      if (!departmentId || visited.has(departmentId)) continue;
      visited.add(departmentId);
      const data = await this.fetchOapi<{ dept_id_list?: number[] }>(
        this.withAccessToken("https://oapi.dingtalk.com/topapi/v2/department/listsubid", accessToken),
        { dept_id: departmentId }
      );
      if (!Array.isArray(data.dept_id_list)) throw new Error("钉钉部门列表不完整，已停止本轮同步");
      if (visited.size > 10000) throw new Error("钉钉部门数量超过本轮安全上限");
      for (const childId of data.dept_id_list) {
        if (!Number.isSafeInteger(Number(childId)) || Number(childId) <= 0) throw new Error("钉钉部门编号无效");
        if (!visited.has(Number(childId))) queue.push(Number(childId));
      }
    }

    return Array.from(visited);
  }

  private async listDepartmentDetails(accessToken: string, departmentIds: number[]) {
    const departments = new Map<string, string>();
    for (const departmentId of departmentIds) {
      try {
        const data = await this.fetchOapi<DingTalkDepartmentDetail>(
          this.withAccessToken("https://oapi.dingtalk.com/topapi/v2/department/get", accessToken),
          { dept_id: departmentId, language: "zh_CN" }
        );
        if (data.name) departments.set(String(departmentId), data.name);
      } catch {
        // 中文注释：单个部门详情失败不阻断整体成员同步，用户主信息仍可正常同步。
      }
    }
    return departments;
  }

  private async listUsersByDepartment(accessToken: string, departmentId: number) {
    const users: DingTalkUserDetail[] = [];
    let cursor = 0;
    let hasMore = true;
    const seen = new Set<number>();

    while (hasMore) {
      if (seen.has(cursor) || seen.size >= 10000) throw new Error("钉钉人员分页重复或超过安全上限，已停止本轮同步");
      seen.add(cursor);
      const data = await this.fetchOapi<{ has_more?: boolean; list?: DingTalkUserDetail[]; next_cursor?: number }>(
        this.withAccessToken("https://oapi.dingtalk.com/topapi/v2/user/list", accessToken),
        {
          dept_id: departmentId,
          cursor,
          size: 100,
          language: "zh_CN"
        }
      );
      if (!Array.isArray(data.list) || typeof data.has_more !== "boolean") throw new Error("钉钉人员分页响应不完整，已停止本轮同步");
      users.push(...data.list);
      hasMore = Boolean(data.has_more);
      cursor = Number(data.next_cursor || 0);
      if (hasMore && (!Number.isSafeInteger(cursor) || cursor <= 0)) throw new Error("钉钉人员分页缺少下一页游标，已停止本轮同步");
    }

    return users;
  }

  private toSelectableUserFromDirectory(detail: DingTalkUserDetail, departments: Map<string, string>): DingTalkSelectableUser {
    const userId = detail.userid || detail.userId || "";
    const departmentId = detail.dept_id_list?.[0] ? String(detail.dept_id_list[0]) : "";
    return {
      dingtalkUserId: userId,
      name: detail.name,
      unionId: detail.unionid || detail.unionId,
      departmentId: departmentId || undefined,
      departmentName: departmentId ? departments.get(departmentId) || detail.department?.[0] : detail.department?.[0],
      position: detail.position ?? detail.title,
      mobile: detail.mobile,
      avatar: detail.avatar
    };
  }

  // 仅明确离职记录可触发归档；权限错误和目录缺失都不能充当离职证据。
  // 官方接口：https://open.dingtalk.com/document/orgapp-server/query-the-details-of-employees-who-have-left-office
  async listDepartures(start: Date, end: Date): Promise<DingTalkDeparture[]> {
    if (this.mockEnabled) {
      const fixture = await this.localDirectoryFixture();
      return (fixture?.departures || []).filter((entry) => entry.occurredAt >= start && entry.occurredAt <= end);
    }
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end || end.getTime() - start.getTime() > 31 * 86400000) {
      throw new Error("离职记录查询范围无效");
    }
    const accessToken = await this.getOpenApiAccessToken();
    const result: DingTalkDeparture[] = [];
    for (let lower = start.getTime(); lower < end.getTime(); lower += 7 * 86400000) {
      const upper = Math.min(lower + 7 * 86400000, end.getTime());
      let nextToken = "";
      const seen = new Set<string>();
      do {
        if (seen.has(nextToken) || seen.size >= 1000) throw new Error("钉钉离职记录分页异常");
        seen.add(nextToken);
        const query = new URLSearchParams({ startTime: new Date(lower).toISOString(), endTime: new Date(upper).toISOString(), maxResults: "100" });
        if (nextToken) query.set("nextToken", nextToken);
        const response = await fetch(`https://api.dingtalk.com/v1.0/contact/empLeaveRecords?${query}`, {
          headers: { "x-acs-dingtalk-access-token": accessToken }, signal: AbortSignal.timeout(20_000)
        });
        const data = await response.json() as { records?: Array<{ userId?: string; leaveTime?: string; leaveReason?: string }>; nextToken?: string; code?: string };
        if (!response.ok || data.code || !Array.isArray(data.records)) throw new Error(`钉钉离职记录查询失败（HTTP ${response.status}），请检查通讯录基本数据读权限`);
        for (const record of data.records) {
          const occurredAt = new Date(record.leaveTime || "");
          if (!record.userId || !Number.isFinite(occurredAt.getTime()) || occurredAt < start || occurredAt > end) throw new Error("钉钉离职记录缺少有效身份或时间");
          result.push({ externalUserId: record.userId, occurredAt, reason: record.leaveReason || "钉钉离职记录确认" });
        }
        if (data.nextToken != null && typeof data.nextToken !== "string") throw new Error("钉钉离职记录游标无效");
        nextToken = data.nextToken || "";
      } while (nextToken);
    }
    return result;
  }

  async sendWorkNotification(receiverUserId: string, message: string | DingTalkWorkNoticeMessage) {
    const msg = typeof message === "string" ? { msgtype: "text" as const, text: { content: message } } : message;
    if (this.mockEnabled) {
      return { mocked: true, receiverUserId, msg };
    }
    const accessToken = await this.getAccessToken();
    const payload = {
      agent_id: Number(this.requireEnv("DINGTALK_AGENT_ID")),
      userid_list: receiverUserId,
      msg
    };
    const url = configuredUrl(process.env.DINGTALK_WORK_NOTICE_URL);
    return url
      ? this.fetchJson(url, { method: "POST", accessToken, body: payload })
      : this.fetchOapi(this.withAccessToken("https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2", accessToken), payload);
  }

  interactiveCardEnabled() {
    return process.env.DINGTALK_INTERACTIVE_CARD_ENABLED === "true";
  }

  async sendInteractiveCard(receiverUserId: string, payload: DingTalkInteractiveCardPayload) {
    if (this.mockEnabled) {
      return { mocked: true, receiverUserId, payload };
    }
    const accessToken = await this.getOpenApiAccessToken();
    const body: Record<string, unknown> = {
      singleChatReceiver: JSON.stringify({ userId: receiverUserId }),
      cardTemplateId: payload.cardTemplateId || process.env.DINGTALK_INTERACTIVE_CARD_TEMPLATE_ID || "StandardCard",
      cardBizId: payload.cardBizId,
      robotCode: payload.robotCode || process.env.DINGTALK_INTERACTIVE_CARD_ROBOT_CODE || process.env.DINGTALK_CLIENT_ID,
      cardData: JSON.stringify(payload.cardData),
      pullStrategy: false
    };
    if (payload.callbackUrl) body.callbackUrl = payload.callbackUrl;

    const url = configuredUrl(process.env.DINGTALK_INTERACTIVE_CARD_SEND_URL) || "https://api.dingtalk.com/v1.0/im/v1.0/robot/interactiveCards/send";
    return this.fetchDingTalkOpenApi(url, accessToken, body);
  }

  private requireEnv(name: string) {
    const value = process.env[name];
    if (!value) throw new Error(`未配置 ${name}`);
    return value;
  }

  private withAccessToken(url: string, accessToken: string) {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}access_token=${encodeURIComponent(accessToken)}`;
  }

  async toSelectableUser(detail: DingTalkUserDetail): Promise<DingTalkSelectableUser> {
    const userId = detail.userid || detail.userId || "";
    let department = {
      departmentId: detail.dept_id_list?.[0] ? String(detail.dept_id_list[0]) : "",
      departmentName: detail.department?.[0] || ""
    };
    try {
      department = await this.getUserDepartmentInfo(detail);
    } catch {
      // 中文注释：通讯录权限不完整时保留用户主信息，人员选择仍可使用。
    }
    return {
      dingtalkUserId: userId,
      name: detail.name,
      unionId: detail.unionid || detail.unionId,
      departmentId: department.departmentId || undefined,
      departmentName: department.departmentName || undefined,
      position: detail.position ?? detail.title,
      mobile: detail.mobile,
      avatar: detail.avatar
    };
  }

  private async fetchOapi<T>(url: string, body?: unknown): Promise<T> {
    // 中文注释：正式环境默认兼容钉钉 OAPI 的 errcode/errmsg/result 响应结构。
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      signal: AbortSignal.timeout(20_000),
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    const data = (text ? JSON.parse(text) : {}) as DingTalkOapiResponse<T>;
    if (!response.ok || (typeof data.errcode === "number" && data.errcode !== 0)) {
      throw new Error(`钉钉接口调用失败：${response.status} ${data.errmsg || text}`);
    }
    return (data.result ?? data) as T;
  }

  private async fetchJson<T>(url: string, options: FetchOptions): Promise<T> {
    const headers: Record<string, string> = {
      "content-type": "application/json"
    };
    if (options.accessToken) headers.authorization = `Bearer ${options.accessToken}`;

    const response = await fetch(url, {
      method: options.method || "GET",
      signal: AbortSignal.timeout(20_000),
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(`钉钉接口调用失败：${response.status} ${text}`);
    }
    return data as T;
  }

  private async fetchDingTalkOpenApi<T>(url: string, accessToken: string, body: unknown): Promise<T> {
    const response = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: {
        "content-type": "application/json",
        "x-acs-dingtalk-access-token": accessToken
      },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(`钉钉接口调用失败：${response.status} ${text}`);
    }
    return data as T;
  }
}
