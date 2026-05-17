// 中文注释：钉钉集成封装，集中处理钉钉开放平台和 AI 表格同步相关逻辑。
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
};

type DingTalkDepartment = {
  dept_id?: string | number;
  deptId?: string | number;
  name?: string;
};

type DingTalkUserListResult = {
  list?: DingTalkUserDetail[];
  has_more?: boolean;
  hasMore?: boolean;
  next_cursor?: number;
  nextCursor?: number;
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
};

export type DingTalkSelectableUser = {
  dingtalkUserId: string;
  name: string;
  departmentId?: string;
  departmentName?: string;
  position?: string;
  mobile?: string;
  avatar?: string;
};

function configuredUrl(value?: string) {
  return value && value.trim().length > 0 ? value.trim() : null;
}

function normalizeOptionalText(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function normalizeOptionalId(value: unknown) {
  const text = normalizeOptionalText(value);
  return text.length > 0 ? text : "";
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

  private get mockEnabled() {
    // 中文注释：本地开发时使用 mock 身份和通知，避免没有钉钉参数时无法调试。
    return process.env.DINGTALK_MOCK_ENABLED !== "false";
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
      return {
        userid: userId,
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
    const departmentId = normalizeOptionalId(user.dept_id_list?.[0]);
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
    return this.listOrganizationUsers({ keyword, maxUsers: 500 });
  }

  async listOrganizationUsers(options: { keyword?: string; maxUsers?: number } = {}) {
    if (this.mockEnabled) {
      return [
        { dingtalkUserId: "demo-admin", name: "王五", departmentName: "信息技术部", position: "IT管理员" },
        { dingtalkUserId: "demo-handler", name: "李四", departmentName: "信息技术部", position: "IT工程师" }
      ] satisfies DingTalkSelectableUser[];
    }

    // 中文注释：通讯录按部门递归读取，解决只读根部门导致人员选择为空的问题。
    const rootDeptId = process.env.DINGTALK_CONTACT_ROOT_DEPT_ID || "1";
    const maxUsers = options.maxUsers ?? Number(process.env.DINGTALK_CONTACT_SYNC_MAX_USERS || 5000);
    const departmentIds = await this.listDepartmentIds(rootDeptId);
    const users = new Map<string, DingTalkSelectableUser>();
    const errors: Error[] = [];
    for (const deptId of departmentIds) {
      let departmentUsers: DingTalkSelectableUser[] = [];
      try {
        departmentUsers = await this.listUsersByDepartment(deptId);
      } catch (error) {
        const typedError = error instanceof Error ? error : new Error(String(error));
        errors.push(typedError);
        if (typedError.message.includes("qyapi_get_department_member")) break;
        // 中文注释：单个部门成员读取失败时继续尝试其他部门，避免选择器整体不可用。
        console.error(`钉钉部门成员读取失败，部门ID=${deptId}：`, typedError.message);
        continue;
      }
      for (const user of departmentUsers) {
        if (!user.dingtalkUserId) continue;
        users.set(user.dingtalkUserId, { ...users.get(user.dingtalkUserId), ...user });
        if (users.size >= maxUsers) break;
      }
      if (users.size >= maxUsers) break;
    }
    if (users.size === 0 && errors.length > 0) {
      throw errors[0];
    }

    const normalized = Array.from(users.values()).sort((first, second) => first.name.localeCompare(second.name, "zh-CN"));
    const text = options.keyword?.trim().toLowerCase();
    if (!text) return normalized;
    return normalized.filter((item) =>
      [item.dingtalkUserId, item.name, item.departmentName, item.position]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(text))
    );
  }

  private async listDepartmentIds(rootDeptId: string) {
    const visited = new Set<string>();
    const queue = [rootDeptId];
    while (queue.length > 0) {
      const deptId = queue.shift()!;
      if (visited.has(deptId)) continue;
      visited.add(deptId);
      try {
        const children = await this.listSubDepartments(deptId);
        for (const child of children) {
          const childId = normalizeOptionalId(child.dept_id ?? child.deptId);
          if (childId && !visited.has(childId)) queue.push(childId);
        }
      } catch (error) {
        // 中文注释：部门列表权限不足时不中断根部门读取，至少让已配置部门的人员可被选择。
        console.error("钉钉子部门读取失败，已降级为当前部门：", error instanceof Error ? error.message : error);
      }
    }
    return Array.from(visited);
  }

  private async listSubDepartments(deptId: string) {
    const accessToken = await this.getAccessToken();
    const url = configuredUrl(process.env.DINGTALK_DEPARTMENT_LIST_URL);
    const payload = { dept_id: Number(deptId), language: "zh_CN" };
    return url
      ? this.fetchJson<DingTalkDepartment[]>(url, { method: "POST", accessToken, body: payload })
      : this.fetchOapi<DingTalkDepartment[]>(
          this.withAccessToken("https://oapi.dingtalk.com/topapi/v2/department/listsub", accessToken),
          payload
        );
  }

  private async listUsersByDepartment(deptId: string) {
    const accessToken = await this.getAccessToken();
    const url = configuredUrl(process.env.DINGTALK_USER_LIST_URL);
    const users: DingTalkSelectableUser[] = [];
    let cursor = 0;
    for (let page = 0; page < 100; page += 1) {
      const payload = {
        dept_id: Number(deptId),
        cursor,
        size: 100,
        language: "zh_CN"
      };
      const data = url
        ? await this.fetchJson<DingTalkUserListResult>(url, { method: "POST", accessToken, body: payload })
        : await this.fetchOapi<DingTalkUserListResult>(
            this.withAccessToken("https://oapi.dingtalk.com/topapi/v2/user/list", accessToken),
            payload
          );
      users.push(...(await Promise.all((data.list || []).map((item) => this.toSelectableUser(item)))));
      if (!(data.has_more ?? data.hasMore)) break;
      cursor = data.next_cursor ?? data.nextCursor ?? cursor + 100;
    }
    return users;
  }

  async sendWorkNotification(receiverUserId: string, content: string) {
    if (this.mockEnabled) {
      return { mocked: true, receiverUserId, content };
    }
    const accessToken = await this.getAccessToken();
    const payload = {
      agent_id: Number(this.requireEnv("DINGTALK_AGENT_ID")),
      userid_list: receiverUserId,
      msg: {
        msgtype: "text",
        text: { content }
      }
    };
    const url = configuredUrl(process.env.DINGTALK_WORK_NOTICE_URL);
    return url
      ? this.fetchJson(url, { method: "POST", accessToken, body: payload })
      : this.fetchOapi(this.withAccessToken("https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2", accessToken), payload);
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
      departmentId: normalizeOptionalId(detail.dept_id_list?.[0]),
      departmentName: detail.department?.[0] || ""
    };
    try {
      department = await this.getUserDepartmentInfo(detail);
    } catch {
      // 中文注释：通讯录权限不完整时保留用户主信息，人员选择仍可使用。
    }
    return {
      dingtalkUserId: normalizeOptionalId(userId),
      name: normalizeOptionalText(detail.name),
      departmentId: normalizeOptionalId(department.departmentId),
      departmentName: normalizeOptionalText(department.departmentName),
      position: normalizeOptionalText(detail.position || detail.title),
      mobile: normalizeOptionalText(detail.mobile),
      avatar: normalizeOptionalText(detail.avatar)
    };
  }

  private async fetchOapi<T>(url: string, body?: unknown): Promise<T> {
    // 中文注释：正式环境默认兼容钉钉 OAPI 的 errcode/errmsg/result 响应结构。
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
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
}
