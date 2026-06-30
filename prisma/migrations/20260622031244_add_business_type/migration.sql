-- AlterTable
ALTER TABLE `device` ADD COLUMN `androidVersion` VARCHAR(191) NULL,
    ADD COLUMN `brand` VARCHAR(191) NULL,
    ADD COLUMN `deviceName` VARCHAR(191) NULL,
    ADD COLUMN `model` VARCHAR(191) NULL,
    ADD COLUMN `pushToken` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `user` ADD COLUMN `businessType` VARCHAR(191) NULL;
