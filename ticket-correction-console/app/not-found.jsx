import { withBasePath } from "@/lib/public-config";

export default function NotFound() {
  return (
    <main className="centered-page">
      <section className="simple-state" aria-labelledby="not-found-title">
        <p className="section-kicker">趣然 IT</p>
        <h1 id="not-found-title">页面不存在</h1>
        <p>请使用已保存的数据更正台固定地址访问。</p>
        <a className="button button-primary" href={withBasePath("/")}>
          返回更正台
        </a>
      </section>
    </main>
  );
}
