-- DropForeignKey
ALTER TABLE `Ticket` DROP FOREIGN KEY `Ticket_applicantUserId_fkey`;

-- DropForeignKey
ALTER TABLE `Ticket` DROP FOREIGN KEY `Ticket_handlerUserId_fkey`;

-- DropForeignKey
ALTER TABLE `CategoryCcRecipient` DROP FOREIGN KEY `CategoryCcRecipient_userId_fkey`;

-- DropForeignKey
ALTER TABLE `TicketCcRecipient` DROP FOREIGN KEY `TicketCcRecipient_userId_fkey`;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `archivedAt` DATETIME(3) NULL,
    ADD COLUMN `departedAt` DATETIME(3) NULL,
    ADD COLUMN `employmentStatus` ENUM('ACTIVE', 'DEPARTED') NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN `lastSyncedAt` DATETIME(3) NULL,
    ADD COLUMN `manuallyDisabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `mergedIntoId` VARCHAR(191) NULL,
    ADD COLUMN `sessionVersion` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `Ticket` ADD COLUMN `applicantId` VARCHAR(191) NULL,
    ADD COLUMN `handlerId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `CategoryCcRecipient` ADD COLUMN `personId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `TicketCcRecipient` ADD COLUMN `personId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Notification` ADD COLUMN `receiverPersonId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `UserIdentity` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `corpId` VARCHAR(191) NOT NULL,
    `externalUserId` VARCHAR(191) NOT NULL,
    `unionId` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `UserIdentity_corpId_unionId_idx`(`corpId`, `unionId`),
    INDEX `UserIdentity_userId_idx`(`userId`),
    UNIQUE INDEX `UserIdentity_corpId_externalUserId_key`(`corpId`, `externalUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PersonnelIdentityAudit` (
    `id` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `operatorId` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NOT NULL,
    `relatedUserId` VARCHAR(191) NULL,
    `reason` TEXT NOT NULL,
    `details` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PersonnelIdentityAudit_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DirectorySyncState` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'directory',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `intervalMinutes` INTEGER NOT NULL DEFAULT 60,
    `nextRunAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lockedBy` VARCHAR(191) NULL,
    `lockedUntil` DATETIME(3) NULL,
    `lastSuccessAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DirectorySyncRun` (
    `id` VARCHAR(191) NOT NULL,
    `trigger` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `lockToken` VARCHAR(191) NULL,
    `operatorId` VARCHAR(191) NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,
    `total` INTEGER NOT NULL DEFAULT 0,
    `createdCount` INTEGER NOT NULL DEFAULT 0,
    `updatedCount` INTEGER NOT NULL DEFAULT 0,
    `unchangedCount` INTEGER NOT NULL DEFAULT 0,
    `departedCount` INTEGER NOT NULL DEFAULT 0,
    `restoredCount` INTEGER NOT NULL DEFAULT 0,
    `pendingCount` INTEGER NOT NULL DEFAULT 0,
    `failedCount` INTEGER NOT NULL DEFAULT 0,
    `errorMessage` TEXT NULL,

    INDEX `DirectorySyncRun_startedAt_idx`(`startedAt`),
    INDEX `DirectorySyncRun_status_startedAt_idx`(`status`, `startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DirectorySyncItem` (
    `id` VARCHAR(191) NOT NULL,
    `runId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `externalUserId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `changesJson` LONGTEXT NULL,
    `errorMessage` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DirectorySyncItem_runId_createdAt_idx`(`runId`, `createdAt`),
    INDEX `DirectorySyncItem_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Ticket_applicantId_idx` ON `Ticket`(`applicantId`);

-- CreateIndex
CREATE INDEX `Ticket_handlerId_idx` ON `Ticket`(`handlerId`);

-- CreateIndex
CREATE INDEX `CategoryCcRecipient_personId_idx` ON `CategoryCcRecipient`(`personId`);

-- CreateIndex
CREATE INDEX `TicketCcRecipient_personId_ticketId_idx` ON `TicketCcRecipient`(`personId`, `ticketId`);

-- CreateIndex
CREATE INDEX `Notification_receiverPersonId_idx` ON `Notification`(`receiverPersonId`);

-- AddForeignKey
ALTER TABLE `UserIdentity` ADD CONSTRAINT `UserIdentity_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ticket` ADD CONSTRAINT `Ticket_applicantId_fkey` FOREIGN KEY (`applicantId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ticket` ADD CONSTRAINT `Ticket_handlerId_fkey` FOREIGN KEY (`handlerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CategoryCcRecipient` ADD CONSTRAINT `CategoryCcRecipient_personId_fkey` FOREIGN KEY (`personId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TicketCcRecipient` ADD CONSTRAINT `TicketCcRecipient_personId_fkey` FOREIGN KEY (`personId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DirectorySyncItem` ADD CONSTRAINT `DirectorySyncItem_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `DirectorySyncRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
