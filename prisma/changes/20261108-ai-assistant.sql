-- AlterTable
-- Widen only: preserves all existing system configuration values.
ALTER TABLE `SystemConfig` MODIFY COLUMN `configValue` LONGTEXT NOT NULL;

ALTER TABLE `Ticket` ADD COLUMN `aiContextSnapshot` LONGTEXT NULL,
    ADD COLUMN `aiConversationId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `AiConversation` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `categoryName` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `busyUntil` DATETIME(3) NULL,
    `activeRequestId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AiConversation_userId_updatedAt_idx`(`userId`, `updatedAt`),
    INDEX `AiConversation_categoryId_idx`(`categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AiMessage` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `attachments` LONGTEXT NULL,
    `references` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'COMPLETE',
    `requestKey` VARCHAR(191) NULL,
    `model` VARCHAR(191) NULL,
    `inputTokens` INTEGER NOT NULL DEFAULT 0,
    `outputTokens` INTEGER NOT NULL DEFAULT 0,
    `errorCode` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AiMessage_requestKey_key`(`requestKey`),
    INDEX `AiMessage_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
    INDEX `AiMessage_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AiTicketDraft` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `priority` ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL',
    `attachments` LONGTEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `ticketId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AiTicketDraft_conversationId_key`(`conversationId`),
    UNIQUE INDEX `AiTicketDraft_ticketId_key`(`ticketId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AiDailyUsage` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `day` VARCHAR(191) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `AiDailyUsage_userId_day_key`(`userId`, `day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `Ticket_aiConversationId_key` ON `Ticket`(`aiConversationId`);

-- AddForeignKey
ALTER TABLE `AiMessage` ADD CONSTRAINT `AiMessage_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `AiConversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AiTicketDraft` ADD CONSTRAINT `AiTicketDraft_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `AiConversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
