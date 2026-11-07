import type { ThemeConfig } from "antd";

export const corporateCleanColors = {
  brand: "#2563eb", brandHover: "#1d4ed8", brandActive: "#1e40af", brandSoft: "#eff6ff", brandBorder: "#bfdbfe",
  background: "#f6f8fd", surface: "#ffffff", heading: "#0f172a", text: "#334155", muted: "#62728a", disabled: "#94a3b8",
  border: "#e2e8f0", controlBorder: "#cbd5e1", success: "#15803d", warning: "#b45309", danger: "#dc2626"
} as const;

const colors = corporateCleanColors;
const shadowSm = "0 1px 2px rgb(30 50 90 / 5%), 0 4px 16px rgb(30 50 90 / 3%)";
const shadowMd = "0 4px 8px -2px rgb(30 50 90 / 10%), 0 12px 24px -12px rgb(30 50 90 / 16%)";
const inputStates = {
  colorBorder: colors.controlBorder,
  hoverBorderColor: colors.brandHover,
  activeBorderColor: colors.brand,
  activeShadow: "0 0 0 2px rgb(37 99 235 / 16%)",
  hoverBg: colors.surface,
  activeBg: colors.surface,
  errorActiveShadow: "0 0 0 2px rgb(220 38 38 / 12%)",
  warningActiveShadow: "0 0 0 2px rgb(180 83 9 / 12%)"
};

// 只统一视觉 token；控件尺寸、表格密度和现有页面布局沿用当前设置。
export const corporateCleanTheme: ThemeConfig = {
  token: {
    colorPrimary: colors.brand, colorPrimaryHover: colors.brandHover, colorPrimaryActive: colors.brandActive,
    colorPrimaryBg: colors.brandSoft, colorPrimaryBgHover: "#dbeafe", colorPrimaryBorder: colors.brandBorder, colorPrimaryBorderHover: "#93c5fd",
    colorPrimaryText: colors.brand, colorPrimaryTextHover: colors.brandHover, colorPrimaryTextActive: colors.brandActive,
    colorInfo: colors.brand, colorInfoHover: colors.brandHover, colorInfoActive: colors.brandActive,
    colorInfoBg: colors.brandSoft, colorInfoBgHover: "#dbeafe", colorInfoBorder: colors.brandBorder, colorInfoBorderHover: "#93c5fd",
    colorInfoText: colors.brand, colorInfoTextHover: colors.brandHover, colorInfoTextActive: colors.brandActive,
    colorSuccess: colors.success, colorSuccessHover: "#166534", colorSuccessActive: "#14532d",
    colorSuccessBg: "#f0fdf4", colorSuccessBgHover: "#dcfce7", colorSuccessBorder: "#bbf7d0", colorSuccessBorderHover: "#86efac",
    colorSuccessText: colors.success, colorSuccessTextHover: "#166534", colorSuccessTextActive: "#14532d",
    colorWarning: colors.warning, colorWarningHover: "#92400e", colorWarningActive: "#78350f",
    colorWarningBg: "#fffbeb", colorWarningBgHover: "#fef3c7", colorWarningBorder: "#fde68a", colorWarningBorderHover: "#fcd34d",
    colorWarningText: colors.warning, colorWarningTextHover: "#92400e", colorWarningTextActive: "#78350f",
    colorError: colors.danger, colorErrorHover: "#b91c1c", colorErrorActive: "#991b1b",
    colorErrorBg: "#fef2f2", colorErrorBgHover: "#fee2e2", colorErrorBorder: "#fecaca", colorErrorBorderHover: "#fca5a5",
    colorErrorText: colors.danger, colorErrorTextHover: "#b91c1c", colorErrorTextActive: "#991b1b",
    colorLink: colors.brand, colorLinkHover: colors.brandHover, colorLinkActive: colors.brandActive,
    colorText: colors.text, colorTextHeading: colors.heading, colorTextLabel: colors.text,
    colorTextSecondary: colors.muted, colorTextDescription: colors.muted, colorTextTertiary: colors.muted,
    colorTextQuaternary: colors.disabled, colorTextPlaceholder: colors.muted, colorTextDisabled: colors.disabled,
    colorTextLightSolid: colors.surface, colorIcon: colors.muted, colorIconHover: colors.text,
    colorBorder: colors.border, colorBorderSecondary: colors.border, colorSplit: colors.border,
    colorBgLayout: colors.background, colorBgContainer: colors.surface, colorBgElevated: colors.surface,
    colorBgContainerDisabled: "#f1f5f9", colorBgMask: "rgb(15 23 42 / 38%)",
    colorFillAlter: colors.background, colorFillContent: "#f1f5f9", colorFillContentHover: colors.border,
    colorBgTextHover: "#f1f5f9", colorBgTextActive: colors.border,
    controlItemBgHover: colors.background, controlItemBgActive: colors.brandSoft, controlItemBgActiveHover: "#dbeafe", controlItemBgActiveDisabled: "#f1f5f9",
    controlOutline: "rgb(37 99 235 / 16%)", controlOutlineWidth: 2,
    colorErrorOutline: "rgb(220 38 38 / 12%)", colorWarningOutline: "rgb(180 83 9 / 12%)",
    borderRadius: 10, borderRadiusSM: 8, borderRadiusXS: 4, borderRadiusLG: 16, borderRadiusOuter: 16,
    boxShadow: shadowMd, boxShadowSecondary: shadowMd, boxShadowTertiary: shadowSm,
    fontSize: 14, fontWeightStrong: 600,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    motionDurationFast: "0.1s", motionDurationMid: "0.15s", motionDurationSlow: "0.2s"
  },
  components: {
    Button: {
      borderRadius: 10, controlHeight: 38, fontWeight: 600,
      primaryColor: colors.surface, defaultColor: colors.text, defaultBg: colors.surface, defaultBorderColor: colors.controlBorder,
      defaultHoverColor: colors.brandHover, defaultHoverBorderColor: colors.brandHover, defaultHoverBg: colors.brandSoft,
      defaultActiveColor: colors.brandActive, defaultActiveBorderColor: colors.brandActive, defaultActiveBg: "#dbeafe",
      borderColorDisabled: colors.border, defaultShadow: shadowSm, primaryShadow: shadowSm, dangerShadow: shadowSm,
      textTextColor: colors.text, textTextHoverColor: colors.heading, textTextActiveColor: colors.heading, textHoverBg: "#f1f5f9"
    },
    Input: inputStates,
    InputNumber: { ...inputStates, handleBorderColor: colors.border, handleHoverColor: colors.brandHover, handleActiveBg: colors.brandSoft },
    Select: {
      colorBorder: colors.controlBorder, hoverBorderColor: colors.brandHover, activeBorderColor: colors.brand, activeOutlineColor: "rgb(37 99 235 / 16%)",
      optionSelectedBg: colors.brandSoft, optionSelectedColor: colors.brandActive, optionSelectedFontWeight: 600, optionActiveBg: colors.background,
      multipleItemBg: "#f1f5f9", multipleItemBorderColor: colors.border, multipleItemColorDisabled: colors.disabled,
      multipleItemBorderColorDisabled: colors.border, multipleSelectorBgDisabled: "#f1f5f9"
    },
    DatePicker: { ...inputStates, cellHoverBg: colors.brandSoft, cellActiveWithRangeBg: colors.brandSoft, cellHoverWithRangeBg: "#dbeafe", cellRangeBorderColor: colors.brandBorder, cellBgDisabled: "#f1f5f9" },
    Form: { labelColor: colors.text, labelRequiredMarkColor: colors.danger },
    Checkbox: { colorBorder: colors.controlBorder },
    Radio: {
      colorBorder: colors.controlBorder, buttonBg: colors.surface, buttonColor: colors.text, buttonCheckedBg: colors.brandSoft,
      buttonSolidCheckedBg: colors.brand, buttonSolidCheckedHoverBg: colors.brandHover, buttonSolidCheckedActiveBg: colors.brandActive,
      buttonSolidCheckedColor: colors.surface, buttonCheckedBgDisabled: "#f1f5f9", buttonCheckedColorDisabled: colors.disabled
    },
    Switch: { handleShadow: shadowSm, colorTextQuaternary: colors.disabled, colorTextTertiary: colors.muted },
    Card: { borderRadiusLG: 16, paddingLG: 24, headerBg: colors.surface, actionsBg: colors.background, extraColor: colors.muted, boxShadowTertiary: shadowSm },
    Table: {
      borderRadius: 8, headerBorderRadius: 8, headerBg: colors.background, headerColor: colors.text, headerSplitColor: colors.border, borderColor: colors.border,
      rowHoverBg: colors.background, rowSelectedBg: colors.brandSoft, rowSelectedHoverBg: "#dbeafe", rowExpandedBg: colors.background,
      headerSortActiveBg: "#f1f5f9", headerSortHoverBg: colors.border, bodySortBg: colors.background, footerBg: colors.background, footerColor: colors.text
    },
    Tag: { defaultBg: "#f1f5f9", defaultColor: colors.text, colorBorder: colors.border },
    Menu: {
      itemBorderRadius: 8, subMenuItemBorderRadius: 8, itemColor: colors.text, itemHoverColor: colors.heading, itemHoverBg: "#f1f5f9",
      itemActiveBg: "#dbeafe", itemSelectedBg: colors.brandSoft, itemSelectedColor: colors.brand, itemDisabledColor: colors.disabled,
      groupTitleColor: colors.muted, popupBg: colors.surface, horizontalItemHoverColor: colors.brandHover, horizontalItemSelectedColor: colors.brand,
      dangerItemColor: colors.danger, dangerItemHoverColor: "#b91c1c", dangerItemActiveBg: "#fee2e2", dangerItemSelectedBg: "#fef2f2", dangerItemSelectedColor: colors.danger
    },
    Modal: { borderRadiusLG: 16, headerBg: colors.surface, contentBg: colors.surface, titleColor: colors.heading, boxShadow: shadowMd },
    Drawer: { colorBgElevated: colors.surface, boxShadowSecondary: shadowMd },
    Tooltip: { colorBgSpotlight: colors.heading, colorTextLightSolid: colors.surface, borderRadius: 8, boxShadowSecondary: shadowMd },
    Popover: { colorBgElevated: colors.surface, boxShadowSecondary: shadowMd },
    Dropdown: { colorBgElevated: colors.surface, boxShadowSecondary: shadowMd },
    Tabs: { itemColor: colors.muted, itemHoverColor: colors.brandHover, itemActiveColor: colors.brandActive, itemSelectedColor: colors.brand, inkBarColor: colors.brand, cardBg: colors.background },
    Segmented: { trackBg: "#f1f5f9", itemColor: colors.muted, itemHoverColor: colors.text, itemHoverBg: colors.border, itemActiveBg: "#dbeafe", itemSelectedBg: colors.brand, itemSelectedColor: colors.surface, boxShadowTertiary: shadowSm },
    Pagination: { itemActiveBg: colors.brandSoft, itemActiveColor: colors.brand, itemActiveColorHover: colors.brandHover, itemActiveBgDisabled: "#f1f5f9", itemActiveColorDisabled: colors.disabled },
    Message: { contentBg: colors.surface, boxShadow: shadowMd },
    Notification: { colorBgElevated: colors.surface, boxShadow: shadowMd },
    Skeleton: { gradientFromColor: "#f1f5f9", gradientToColor: colors.border, blockRadius: 8 }
  }
};
