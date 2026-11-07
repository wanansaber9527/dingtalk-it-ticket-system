"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/client-api";
import { withBasePath } from "@/lib/public-config";

export function LoginForm() {
  const [hydrated, setHydrated] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setHydrated(true);
  }, []);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password })
      });
      window.location.assign(withBasePath("/"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "登录失败");
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page" id="main-content">
      <section className="login-intro" aria-labelledby="login-title">
        <div>
          <p className="section-kicker">趣然 · IT 工作台</p>
          {process.env.NEXT_PUBLIC_LOCAL_PREVIEW === "true" && <p className="local-preview-badge">本地预览 · 示例数据</p>}
          <h1 id="login-title">工单数据<br />更正台</h1>
          <p className="login-summary">
            在独立工作台中核对工单信息。先查看差异，再确认保存，让记录准确、清晰。
          </p>
        </div>
        <dl className="login-facts">
          <div>
            <dt>访问方式</dt>
            <dd>独立账号</dd>
          </div>
          <div>
            <dt>写入范围</dt>
            <dd>所选工单</dd>
          </div>
          <div>
            <dt>通知策略</dt>
            <dd>不发送通知</dd>
          </div>
        </dl>
      </section>

      <section className="login-panel" aria-label="登录表单">
        <div className="login-panel-heading">
          <p className="section-kicker">工单数据更正台</p>
          <h2>欢迎回来</h2>
          <p>使用专用账户登录，本页面不识别钉钉身份。</p>
        </div>

        <form
          action={withBasePath("/api/auth/login")}
          method="post"
          onSubmit={submit}
          className="form-stack"
          noValidate
        >
          <label className="field">
            <span>账号</span>
            <input
              name="username"
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck="false"
              required
              disabled={!hydrated || submitting}
            />
          </label>

          <div className="field">
            <label htmlFor="correction-password">密码</label>
            <span className="password-control">
              <input
                id="correction-password"
                name="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
                disabled={!hydrated || submitting}
              />
              <button
                className="password-toggle"
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                aria-pressed={showPassword}
                disabled={!hydrated || submitting}
              >
                {showPassword ? "隐藏" : "显示"}
              </button>
            </span>
          </div>

          {error && (
            <div className="inline-alert inline-alert-error" role="alert">
              {error}
            </div>
          )}

          <button
            className="button button-primary button-wide"
            type="submit"
            disabled={!hydrated || submitting}
          >
            {!hydrated ? "正在准备" : submitting ? "正在校验" : "登录"}
          </button>
        </form>

        <p className="login-footnote">连续登录失败会暂时锁定当前来源，请勿反复尝试。</p>
      </section>
    </main>
  );
}
