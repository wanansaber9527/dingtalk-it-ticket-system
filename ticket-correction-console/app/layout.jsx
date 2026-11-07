import "@/app/globals.css";

export const metadata = {
  title: "趣然 IT 工单数据更正台",
  description: "内部工单数据更正工具",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nocache: true
  }
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light"
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>
        <a className="skip-link" href="#main-content">
          跳至主要内容
        </a>
        {children}
      </body>
    </html>
  );
}
