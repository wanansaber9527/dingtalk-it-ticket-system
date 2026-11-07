"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Empty, Segmented, Skeleton, Table } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiGet } from "@/src/lib/clientApi";

type Ranking = { name: string; count: number };
type Dashboard = {
  cards: {
    todayNew: number; weekNew: number; monthNew: number; total: number;
    pending: number; assigned: number; processing: number; returned: number;
    completed: number; rejected: number; cancelled: number; overdue: number;
    firstResponseOverdueRate: number; resolveOverdueRate: number;
    averageFirstResponseMinutes: number; averageResolveMinutes: number;
    satisfaction: { satisfied: number; normal: number; unsatisfied: number };
  };
  rankings: { category: Ranking[]; department: Ranking[]; handler: Ranking[]; handlerAverageResolve: Array<{ handlerName: string; averageMinutes: number }> };
};

function minutesText(value: number) {
  if (value < 60) return `${value} 分钟`;
  return `${Math.round(value / 6) / 10} 小时`;
}

function PanelHeading({ title, description }: { title: string; description: string }) {
  return <div className="dashboard-panel-heading"><h2>{title}</h2><p>{description}</p></div>;
}

const statusColors = ["#22c55e", "#0e7490", "#2563eb", "#b45309", "#15803d", "#dc2626", "#64748b"];
const columns = [{ title: "名称", dataIndex: "name" }, { title: "工单量", dataIndex: "count", width: 90, align: "right" as const }];
const shanghaiDate = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric", weekday: "long" });

export default function AdminDashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [mode, setMode] = useState<"classic" | "graphic">("graphic");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewedAt, setViewedAt] = useState<Date | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setData(await apiGet<Dashboard>("/api/admin/dashboard")); }
    catch (e) { setError(e instanceof Error ? e.message : "加载失败"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { setViewedAt(new Date()); void load(); }, [load]);
  const cards = data?.cards;
  const statusData = cards ? [
    { name: "待受理", value: cards.pending }, { name: "已分派", value: cards.assigned },
    { name: "处理中", value: cards.processing }, { name: "待补充", value: cards.returned },
    { name: "已完成 / 关闭", value: cards.completed }, { name: "已驳回", value: cards.rejected },
    { name: "已撤销", value: cards.cancelled }
  ] : [];

  return <div className="dashboard-v2">
    <div className="dashboard-header">
      <div className="dashboard-heading">
        <div className="dashboard-topline">{viewedAt ? <time dateTime={viewedAt.toISOString()}>{shanghaiDate.format(viewedAt)}</time> : "北京时间"}</div>
        <h1>服务概览</h1>
        <p>全部历史工单，按当前状态、问题分类与处理人汇总。</p>
      </div>
      <div className="dashboard-actions">
        <Segmented aria-label="看板显示方式" value={mode} onChange={(v) => setMode(v as typeof mode)} options={[{ label: "图表概览", value: "graphic" }, { label: "详细数据", value: "classic" }]} />
        <Button aria-label="刷新看板" icon={<ReloadOutlined />} onClick={load} loading={loading} />
      </div>
    </div>

    {error && <Alert type="error" showIcon message={error} action={<Button size="small" onClick={load}>重试</Button>} style={{ marginBottom: 20 }} />}
    {!data ? loading && <Card><Skeleton active paragraph={{ rows: 8 }} /></Card> : <>
      <section className="overview-metrics summary-surface" aria-label="工单数据概览">
        <div className="overview-metric summary-primary">
          <div className="summary-caption">历史累计</div>
          <div className="metric-label">全部工单</div>
          <div className="summary-total"><strong className="metric-value">{cards!.total.toLocaleString("zh-CN")}</strong><span className="summary-unit">单</span></div>
          <div className="summary-periods">
            <span>今日新增 <b>{cards!.todayNew}</b></span>
            <span>本周新增 <b>{cards!.weekNew}</b></span>
            <span>本月新增 <b>{cards!.monthNew}</b></span>
          </div>
        </div>
        {[
          { label: "待处理", value: cards!.pending + cards!.assigned + cards!.processing, note: `待受理 ${cards!.pending} · 已分派 ${cards!.assigned} · 处理中 ${cards!.processing}` },
          { label: "已完成 / 关闭", value: cards!.completed, note: "已完成与已关闭状态合计" },
          { label: "超时工单", value: cards!.overdue, note: "首响或处理超时的工单", alert: true }
        ].map(item => <div key={item.label} className={`overview-metric summary-secondary${item.alert ? " is-alert" : ""}`}>
          <div className="metric-label">{item.label}</div>
          <strong className="metric-value">{item.value.toLocaleString("zh-CN")}</strong>
          <div className="metric-footnote">{item.note}</div>
        </div>)}
      </section>

      {mode === "graphic" ? <div className="dashboard-grid dashboard-analysis-grid">
        <Card className="dashboard-panel-category" title={<PanelHeading title="服务需求分布" description="按工单量排序，展示前 8 个问题分类" />}>
          {data.rankings.category.length ? <ResponsiveContainer width="100%" height={310}>
            <BarChart accessibilityLayer data={data.rankings.category} layout="vertical" margin={{ left: 0, right: 36, top: 8, bottom: 8 }}>
              <CartesianGrid stroke="#e2e8f0" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#64748b" }} />
              <YAxis type="category" dataKey="name" width={110} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#64748b" }} />
              <Tooltip formatter={v => [`${v} 单`, "工单量"]} cursor={{ fill: "#eff6ff" }} contentStyle={{ borderColor: "#e2e8f0", color: "#334155" }} labelStyle={{ color: "#0f172a" }} itemStyle={{ color: "#334155" }} />
              <Bar dataKey="count" fill="#2563eb" maxBarSize={18} radius={[0, 3, 3, 0]} isAnimationActive={false}>
                <LabelList dataKey="count" position="right" fill="#334155" fontSize={12} />
              </Bar>
            </BarChart>
          </ResponsiveContainer> : <Empty description="暂无分类数据" />}
        </Card>
        <Card className="dashboard-panel-status" title={<PanelHeading title="当前工单状态" description="全部工单的当前状态分布" />}>
          <div className="status-chart-layout">
            {cards!.total ? <div className="status-donut"><ResponsiveContainer width="100%" height={202}>
              <PieChart accessibilityLayer>
                <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={62} outerRadius={84} paddingAngle={2} stroke="none" isAnimationActive={false}>
                  {statusData.map((item, i) => <Cell key={item.name} fill={statusColors[i]} />)}
                </Pie>
                <Tooltip formatter={(v, n) => [`${v} 单`, n]} contentStyle={{ borderColor: "#e2e8f0", color: "#334155" }} labelStyle={{ color: "#0f172a" }} itemStyle={{ color: "#334155" }} />
              </PieChart>
            </ResponsiveContainer></div> : <Empty description="暂无工单数据" />}
            <div className="chart-legend">{statusData.map((item, i) => <span key={item.name}><i aria-hidden="true" style={{ background: statusColors[i] }} />{item.name}<b>{item.value}</b></span>)}</div>
          </div>
        </Card>
      </div> : <div className="metric-grid dashboard-detail-metrics">{[
        ["今日新增", cards!.todayNew], ["本周新增", cards!.weekNew], ["本月新增", cards!.monthNew],
        ["待受理", cards!.pending], ["已分派", cards!.assigned], ["处理中", cards!.processing],
        ["待补充", cards!.returned], ["已驳回", cards!.rejected], ["已撤销", cards!.cancelled]
      ].map(([name, value]) => <div className="metric-card" key={name}><div className="metric-label">{name}</div><strong className="metric-value">{value}</strong></div>)}</div>}

      <Card className="dashboard-quality" title={<PanelHeading title="服务质量" description="超时率以全部工单为基数，平均时长按有对应时间记录的工单统计" />}>
        <div className="sla-grid">{[
          ["首响超时率", `${cards!.firstResponseOverdueRate}%`],
          ["完成超时率", `${cards!.resolveOverdueRate}%`],
          ["平均首次响应", minutesText(cards!.averageFirstResponseMinutes)],
          ["平均处理时长", minutesText(cards!.averageResolveMinutes)]
        ].map(([label, value]) => <div className="sla-stat" key={label}><span className="metric-label">{label}</span><strong>{value}</strong></div>)}</div>
        <div className="satisfaction-bar"><span>服务评价</span><span>满意 <b>{cards!.satisfaction.satisfied}</b></span><span>一般 <b>{cards!.satisfaction.normal}</b></span><span>不满意 <b>{cards!.satisfaction.unsatisfied}</b></span></div>
      </Card>

      <div className={`dashboard-grid dashboard-ranking-grid${mode === "classic" ? " is-detailed" : ""}`}>
        <Card title={<PanelHeading title="处理人工单量" description="按工单量排序 · 前 8 位" />}><Table size="small" rowKey="name" pagination={false} dataSource={data.rankings.handler} columns={columns} /></Card>
        <Card title={<PanelHeading title="部门工单量" description="按申请部门汇总 · 前 8 位" />}><Table size="small" rowKey="name" pagination={false} dataSource={data.rankings.department} columns={columns} /></Card>
        {mode === "classic" && <Card title={<PanelHeading title="问题分类排行" description="按工单量排序 · 前 8 类" />}><Table size="small" rowKey="name" pagination={false} dataSource={data.rankings.category} columns={columns} /></Card>}
        <Card title={<PanelHeading title="处理人平均完成时长" description="按平均时长从短到长 · 前 8 位" />}><Table size="small" rowKey="handlerName" pagination={false} dataSource={data.rankings.handlerAverageResolve} columns={[{ title: "处理人", dataIndex: "handlerName" }, { title: "平均完成", dataIndex: "averageMinutes", render: minutesText, align: "right" }]} /></Card>
      </div>
    </>}
  </div>;
}
