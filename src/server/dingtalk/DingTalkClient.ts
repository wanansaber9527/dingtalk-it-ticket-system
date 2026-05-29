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
      return [
        { dingtalkUserId: "demo-admin", name: "王五", departmentName: "信息技术部", position: "超级管理员" },
        { dingtalkUserId: "demo-handler", name: "李四", departmentName: "信息技术部", position: "IT工程师" }
      ] satisfies DingTalkSelectableUser[];
    }

    const accessToken = await this.getAccessToken();
    const data = await this.fetchOapi<{ list?: DingTalkUserDetail[] }>(
      this.withAccessToken("https://oapi.dingtalk.com/topapi/v2/user/list", accessToken),
      {
        dept_id: 1,
        cursor: 0,
        size: 100,
        language: "zh_CN"
      }
    );
    const normalized = await Promise.all((data.list || []).map((item) => this.toSelectableUser(item)));
    const text = keyword?.trim().toLowerCase();
    if (!text) return normalized;
    return normalized.filter((item) =>
      [item.dingtalkUserId, item.name, item.departmentName, item.position]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(text))
    );
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
      departmentId: department.departmentId,
      departmentName: department.departmentName,
      position: detail.position || detail.title || "",
      mobile: detail.mobile,
      avatar: detail.avatar
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

  private async fetchDingTalkOpenApi<T>(url: string, accessToken: string, body: unknown): Promise<T> {
    const response = await fetch(url, {
      method: "POST",
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
