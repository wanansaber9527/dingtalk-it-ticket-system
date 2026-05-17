"use client";

// 中文注释：员工端知识库搜索页面，用于查询常见问题解决方案。

import { useEffect, useState } from "react";
import { Button, Card, Empty, Form, Input, List, Select, Space, Typography, message } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { EmployeeShell } from "@/components/tickets/EmployeeShell";
import { apiGet } from "@/src/lib/clientApi";

type Category = { id: string; name: string };
type Knowledge = {
  id: string;
  title: string;
  categoryName?: string;
  problemDescription: string;
  solutionSteps: string;
  updatedAt: string;
};

export default function KnowledgeBasePage() {
  const [form] = Form.useForm();
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Knowledge[]>([]);

  useEffect(() => {
    apiGet<Category[]>("/api/categories").then(setCategories).catch((error) => message.error(error.message));
    const params = new URLSearchParams(window.location.search);
    const keyword = params.get("keyword") || "";
    form.setFieldValue("keyword", keyword);
    search({ keyword });
  }, []);

  async function search(values?: { keyword?: string; categoryId?: string }) {
    const query = new URLSearchParams();
    if (values?.keyword) query.set("keyword", values.keyword);
    if (values?.categoryId) query.set("categoryId", values.categoryId);
    try {
      setItems(await apiGet<Knowledge[]>(`/api/knowledge-base/search?${query.toString()}`));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "查询失败");
    }
  }

  return (
    <EmployeeShell title="知识库搜索">
      <Space direction="vertical" size={14} style={{ width: "100%" }}>
        <Form form={form} layout="vertical" onFinish={search}>
          <Form.Item name="keyword" label="关键词">
            <Input placeholder="搜索问题、现象或解决步骤" allowClear />
          </Form.Item>
          <Form.Item name="categoryId" label="问题分类">
            <Select
              allowClear
              placeholder="全部分类"
              options={categories.map((item) => ({ value: item.id, label: item.name }))}
            />
          </Form.Item>
          <Button type="primary" icon={<SearchOutlined />} htmlType="submit" block>
            搜索
          </Button>
        </Form>

        {items.length === 0 ? (
          <Empty description="暂无匹配知识" />
        ) : (
          <List
            dataSource={items}
            renderItem={(item) => (
              <List.Item style={{ padding: "8px 0" }}>
                <Card size="small" style={{ width: "100%" }}>
                  <Typography.Text strong>{item.title}</Typography.Text>
                  <div className="muted" style={{ marginTop: 4 }}>
                    {item.categoryName || "未分类"} · {new Date(item.updatedAt).toLocaleDateString()}
                  </div>
                  <Typography.Paragraph style={{ marginTop: 10 }} className="timeline-note">
                    {item.solutionSteps}
                  </Typography.Paragraph>
                </Card>
              </List.Item>
            )}
          />
        )}
      </Space>
    </EmployeeShell>
  );
}
