import { Router, Request, Response, NextFunction } from "express";
import { createPublicClient, createWalletClient, http, custom } from "viem";
import { baseSepolia } from "viem/chains";
import { PrismaClient } from "@prisma/client";
import { decryptData } from "../utils/crypto";
import { validateApiKey, hashApiKey } from "../utils/apiKey";
import { getFromPinata } from "../services/pinata";
import { DatasetTokenABI } from "../utils/DatasetTokenABI";
import crypto from "crypto";
import { privateKeyToAccount } from "viem/accounts";

const router = Router();
const prisma = new PrismaClient();

// Environment variables
const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";
const DATASET_CONTRACT_ADDRESS = process.env
    .DATASET_CONTRACT_ADDRESS as `0x${string}`;

// Initialize Viem client
const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
});

// Cache for quote hashes
const quoteCache = new Map<string, { timestamp: number; data: any }>();

// Extend Request type to include wallet
declare global {
    namespace Express {
        interface Request {
            wallet?: {
                address: `0x${string}`;
                encryptedPrivateKey: string;
                keyPairIV: string;
                keyPairAuthTag: string;
            };
        }
    }
}

type DatasetMetadata = [
    name: string,
    description: string,
    contentHash: string,
    ipfsHash: string,
    currentPrice: bigint,
    tags: string[]
];

// Middleware to validate API key and attach wallet info
const validateApiKeyMiddleware = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    const apiKey = req.headers["x-api-key"] as string;
    if (!apiKey) {
        res.status(401).json({ error: "API key is required" });
        return;
    }

    try {
        const hashedKey = await hashApiKey(apiKey);
        const keyData = await prisma.apiKey.findFirst({
            where: {
                key: hashedKey,
                isActive: true,
                OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
        });

        if (
            !keyData ||
            !keyData.publicKey ||
            !keyData.encryptedPrivateKey ||
            !keyData.keyPairIV ||
            !keyData.keyPairAuthTag
        ) {
            res.status(401).json({ error: "Invalid API key" });
            return;
        }

        // Attach wallet info to request
        req.wallet = {
            address: keyData.publicKey as `0x${string}`,
            encryptedPrivateKey: keyData.encryptedPrivateKey,
            keyPairIV: keyData.keyPairIV,
            keyPairAuthTag: keyData.keyPairAuthTag,
        };

        next();
    } catch (error) {
        console.error("API key validation error:", error);
        res.status(500).json({ error: "Failed to validate API key" });
    }
};

// Quote endpoint
router.get(
    "/quote",
    validateApiKeyMiddleware,
    async (req: Request, res: Response): Promise<void> => {
        const { searchParam } = req.query;

        if (!searchParam || typeof searchParam !== "string") {
            res.status(400).json({
                success: false,
                message: "Search parameter is required",
            });
            return;
        }

        try {
            // Get tokens by tag
            const tokenIds = (await publicClient.readContract({
                address: DATASET_CONTRACT_ADDRESS,
                abi: DatasetTokenABI,
                functionName: "getTokensByTag",
                args: [searchParam],
            })) as bigint[];

            if (!tokenIds || tokenIds.length === 0) {
                res.status(404).json({
                    success: false,
                    message: "No datasets found with the given tag",
                });
                return;
            }

            // Fetch metadata for each token
            const datasetsPromises = tokenIds.map(async (tokenId) => {
                const metadata = (await publicClient.readContract({
                    address: DATASET_CONTRACT_ADDRESS,
                    abi: DatasetTokenABI,
                    functionName: "getDatasetMetadata",
                    args: [BigInt(tokenId)],
                })) as DatasetMetadata;

                const tags = (await publicClient.readContract({
                    address: DATASET_CONTRACT_ADDRESS,
                    abi: DatasetTokenABI,
                    functionName: "getTokenTags",
                    args: [tokenId],
                })) as string[];

                return {
                    tokenId: tokenId.toString(),
                    name: metadata[0],
                    description: metadata[1],
                    price: metadata[4].toString(),
                    tags,
                };
            });

            const datasets = await Promise.all(datasetsPromises);

            // Generate quote hash
            const quoteHash = crypto.randomBytes(32).toString("hex");

            // Store quote in cache with 10-second expiration
            quoteCache.set(quoteHash, {
                timestamp: Date.now(),
                data: datasets,
            });

            res.json({
                success: true,
                datasets,
                quoteHash,
            });
        } catch (error) {
            console.error("Error fetching quote:", error);
            res.status(500).json({
                success: false,
                message:
                    error instanceof Error
                        ? error.message
                        : "An unknown error occurred",
            });
        }
    }
);

// Datasets endpoint
router.post(
    "/datasets",
    validateApiKeyMiddleware,
    async (req: Request, res: Response): Promise<void> => {
        const { tokenIds, quoteHash } = req.body;

        if (!tokenIds || !Array.isArray(tokenIds) || !quoteHash) {
            res.status(400).json({
                success: false,
                message: "Invalid request body",
            });
            return;
        }

        // Validate quote hash and check expiration
        const quote = quoteCache.get(quoteHash);
        if (!quote || Date.now() - quote.timestamp > 10000) {
            res.status(400).json({
                success: false,
                message: "Quote has expired. Please request a new quote.",
            });
            return;
        }

        try {
            const wallet = req.wallet!;
            const balance = await publicClient.getBalance({
                address: wallet.address,
            });

            let totalPrice = BigInt(0);
            const datasetsToProcess = [];

            for (const tokenId of tokenIds) {
                const [userBalance, hasPurchased] = await Promise.all([
                    publicClient.readContract({
                        address: DATASET_CONTRACT_ADDRESS,
                        abi: DatasetTokenABI,
                        functionName: "balanceOf",
                        args: [wallet.address, BigInt(tokenId)],
                    }) as Promise<bigint>,
                    publicClient.readContract({
                        address: DATASET_CONTRACT_ADDRESS,
                        abi: DatasetTokenABI,
                        functionName: "hasPurchased",
                        args: [wallet.address, BigInt(tokenId)],
                    }) as Promise<boolean>,
                ]);

                if (userBalance > BigInt(0) || hasPurchased) {
                    const metadata = (await publicClient.readContract({
                        address: DATASET_CONTRACT_ADDRESS,
                        abi: DatasetTokenABI,
                        functionName: "getDatasetMetadata",
                        args: [BigInt(tokenId)],
                    })) as DatasetMetadata;

                    datasetsToProcess.push({
                        tokenId,
                        ipfsHash: metadata[3],
                        name: metadata[0],
                        description: metadata[1],
                        owned: true,
                    });
                } else {
                    // User needs to purchase this dataset
                    const metadata = (await publicClient.readContract({
                        address: DATASET_CONTRACT_ADDRESS,
                        abi: DatasetTokenABI,
                        functionName: "getDatasetMetadata",
                        args: [BigInt(tokenId)],
                    })) as DatasetMetadata;

                    totalPrice += metadata[4];
                    datasetsToProcess.push({
                        tokenId,
                        ipfsHash: metadata[3],
                        price: metadata[4],
                        owned: false,
                    });
                }
            }

            // Check if user has enough balance for non-owned datasets
            if (totalPrice > balance) {
                res.status(400).json({
                    success: false,
                    message: "Insufficient balance to purchase datasets",
                });
                return;
            }

            // Process datasets
            const results = [];
            for (const dataset of datasetsToProcess) {
                if (!dataset.owned) {
                    // Decrypt private key
                    const privateKey = decryptData(
                        wallet.encryptedPrivateKey,
                        wallet.keyPairIV,
                        wallet.keyPairAuthTag
                    );

                    // Add '0x' prefix if missing and cast to the correct type
                    const formattedPrivateKey = (
                        privateKey.startsWith("0x")
                            ? privateKey
                            : `0x${privateKey}`
                    ) as `0x${string}`;

                    // Convert private key to account
                    const account = privateKeyToAccount(formattedPrivateKey);

                    // Create wallet client for transaction
                    const walletClient = createWalletClient({
                        account,
                        chain: baseSepolia,
                        transport: http(RPC_URL),
                    });

                    // Purchase dataset
                    const hash = await walletClient.writeContract({
                        address: DATASET_CONTRACT_ADDRESS,
                        abi: DatasetTokenABI,
                        functionName: "purchaseDataset",
                        args: [BigInt(dataset.tokenId)],
                        value: dataset.price,
                    });

                    await publicClient.waitForTransactionReceipt({ hash });
                }

                try {
                    // Fetch dataset from IPFS
                    const downloadUrl = await getFromPinata(dataset.ipfsHash);
                    const response = await fetch(downloadUrl);

                    // Check content type from response headers
                    const contentType = response.headers.get("content-type");

                    let data: any;
                    if (contentType?.includes("application/json")) {
                        // Handle JSON data
                        data = await response.json();
                    } else if (
                        contentType?.includes("text/csv") ||
                        dataset.name?.toLowerCase().includes(".csv")
                    ) {
                        // Handle CSV data
                        const text = await response.text();
                        data = {
                            type: "csv",
                            content: text,
                        };
                    } else if (
                        contentType?.includes(
                            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        ) ||
                        contentType?.includes("application/vnd.ms-excel") ||
                        dataset.name?.toLowerCase().includes(".xlsx")
                    ) {
                        // Handle Excel data
                        const buffer = await response.arrayBuffer();
                        data = {
                            type: "excel",
                            content: Buffer.from(buffer).toString("base64"),
                        };
                    } else {
                        // Default to raw buffer if type is unknown
                        const buffer = await response.arrayBuffer();
                        data = {
                            type: "binary",
                            content: Buffer.from(buffer).toString("base64"),
                            contentType:
                                contentType || "application/octet-stream",
                        };
                    }

                    results.push({
                        tokenId: dataset.tokenId,
                        data,
                        purchased: !dataset.owned,
                        metadata: {
                            name: dataset.name,
                            description: dataset.description,
                        },
                    });
                } catch (error: any) {
                    console.error(
                        `Error processing dataset ${dataset.tokenId}:`,
                        error
                    );
                    results.push({
                        tokenId: dataset.tokenId,
                        error: `Failed to process dataset: ${error.message}`,
                        purchased: !dataset.owned,
                    });
                }
            }

            res.json({
                success: true,
                datasets: results,
            });
        } catch (error) {
            console.error("Error processing datasets:", error);
            res.status(500).json({
                success: false,
                message:
                    error instanceof Error
                        ? error.message
                        : "An unknown error occurred",
            });
        }
    }
);

export default router;
