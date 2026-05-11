/*
  Warnings:

  - The primary key for the `UserMemory` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `id` on the `UserMemory` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `UserMemory` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "UserMemory_userId_idx";

-- DropIndex
DROP INDEX "UserMemory_userId_key";

-- AlterTable
ALTER TABLE "UserMemory" DROP CONSTRAINT "UserMemory_pkey",
DROP COLUMN "id",
DROP COLUMN "updatedAt",
ADD CONSTRAINT "UserMemory_pkey" PRIMARY KEY ("userId");
