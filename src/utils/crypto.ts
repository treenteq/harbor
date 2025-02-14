import crypto from "crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// Using a buffer of exact length required for AES-256
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
    ? Buffer.from(process.env.ENCRYPTION_KEY, "hex")
    : crypto.randomBytes(32);
const ENCRYPTION_ALGORITHM = "aes-256-gcm";

interface EncryptedData {
    encryptedData: string;
    iv: string;
    authTag: string;
}

export interface EthereumKeyPair {
    address: string;
    privateKey: string;
}

export function generateEthereumKeyPair(): EthereumKeyPair {
    // Generate a new private key
    const privateKey = generatePrivateKey();
    // Create an account from the private key
    const account = privateKeyToAccount(privateKey);

    return {
        address: account.address,
        privateKey: privateKey,
    };
}

export function encryptData(data: string): EncryptedData {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
        ENCRYPTION_ALGORITHM,
        ENCRYPTION_KEY,
        iv
    );

    let encryptedData = cipher.update(data, "utf8", "hex");
    encryptedData += cipher.final("hex");
    const authTag = cipher.getAuthTag();

    return {
        encryptedData,
        iv: iv.toString("hex"),
        authTag: authTag.toString("hex"),
    };
}

export function decryptData(
    encryptedData: string,
    iv: string,
    authTag: string
): string {
    const decipher = crypto.createDecipheriv(
        ENCRYPTION_ALGORITHM,
        ENCRYPTION_KEY,
        Buffer.from(iv, "hex")
    );

    decipher.setAuthTag(Buffer.from(authTag, "hex"));

    let decrypted = decipher.update(encryptedData, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
}
