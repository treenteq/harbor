-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN     "encryptedPrivateKey" TEXT,
ADD COLUMN     "keyPairAuthTag" TEXT,
ADD COLUMN     "keyPairIV" TEXT,
ADD COLUMN     "publicKey" TEXT;
