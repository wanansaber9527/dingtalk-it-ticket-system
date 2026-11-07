/** 工单服务标识；名称由相邻文字提供，图形不重复朗读。 */
export function ServiceMark() {
  return (
    <svg className="service-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
      <path d="M11 5h12a4 4 0 0 1 4 4v12" stroke="currentColor" strokeWidth="1.8" opacity=".45" />
      <rect x="5" y="9" width="18" height="18" rx="4" fill="currentColor" fillOpacity=".06" stroke="currentColor" strokeWidth="1.8" />
      <path d="m10 18 3 3 5-6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
