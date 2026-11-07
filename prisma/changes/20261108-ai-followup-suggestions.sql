-- AI 回复的可选追问建议。旧消息保持 NULL；正文与建议分开保存。
-- 本轮仅在隔离本地数据库应用；发布时须先确认当前库是否已有该字段。
ALTER TABLE `AiMessage` ADD COLUMN `suggestions` TEXT NULL;
