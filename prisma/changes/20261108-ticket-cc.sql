-- AlterTable
ALTER TABLE `Notification` ADD COLUMN `eventKey` VARCHAR(191) NULL,
    ADD COLUMN `recipientKind` VARCHAR(16) NOT NULL DEFAULT 'PRIMARY';

-- CreateTable
CREATE TABLE `CategoryCcRecipient` (
    `id` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CategoryCcRecipient_userId_idx`(`userId`),
    UNIQUE INDEX `CategoryCcRecipient_categoryId_userId_key`(`categoryId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TicketCcRecipient` (
    `id` VARCHAR(191) NOT NULL,
    `ticketId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `userName` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TicketCcRecipient_userId_ticketId_idx`(`userId`, `ticketId`),
    UNIQUE INDEX `TicketCcRecipient_ticketId_userId_key`(`ticketId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CategoryCcRecipient` ADD CONSTRAINT `CategoryCcRecipient_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `TicketCategory`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CategoryCcRecipient` ADD CONSTRAINT `CategoryCcRecipient_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`dingtalkUserId`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TicketCcRecipient` ADD CONSTRAINT `TicketCcRecipient_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `Ticket`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TicketCcRecipient` ADD CONSTRAINT `TicketCcRecipient_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`dingtalkUserId`) ON DELETE CASCADE ON UPDATE CASCADE;
