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
                    args: [tokenId],
                })) as [string, string, string, string, bigint];

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

            // Check balance
            const balance = await publicClient.getBalance({
                address: wallet.address,
            });

            // Calculate total price
            let totalPrice = BigInt(0);
            const datasetsToProcess = [];

            for (const tokenId of tokenIds) {
                // Check if user already owns the dataset
                const userBalance = (await publicClient.readContract({
                    address: DATASET_CONTRACT_ADDRESS,
                    abi: DatasetTokenABI,
                    functionName: "balanceOf",
                    args: [wallet.address, BigInt(tokenId)],
                })) as bigint;

                if (userBalance > BigInt(0)) {
                    // User already owns this dataset
                    const metadata = (await publicClient.readContract({
                        address: DATASET_CONTRACT_ADDRESS,
                        abi: DatasetTokenABI,
                        functionName: "getDatasetMetadata",
                        args: [BigInt(tokenId)],
                    })) as [string, string, string, string, bigint];

                    datasetsToProcess.push({
                        tokenId,
                        ipfsHash: metadata[3],
                        owned: true,
                    });
                } else {
                    // User needs to purchase this dataset
                    const metadata = (await publicClient.readContract({
                        address: DATASET_CONTRACT_ADDRESS,
                        abi: DatasetTokenABI,
                        functionName: "getDatasetMetadata",
                        args: [BigInt(tokenId)],
                    })) as [string, string, string, string, bigint];

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
                    console.log("Wallet: ", wallet);
                    // Decrypt private key
                    const privateKey = decryptData(
                        wallet.encryptedPrivateKey,
                        wallet.keyPairIV,
                        wallet.keyPairAuthTag
                    );

                    console.log(privateKey);

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

                    // // Create wallet client for transaction
                    // const walletClient = createWalletClient({
                    //     account: privateKeyToAccount(
                    //         privateKey
                    //     ) as `0x${string}`,
                    //     chain: baseSepolia,
                    //     transport: http(RPC_URL),
                    // });

                    console.log(
                        "asdasdasdsasdasdjaskdhasjkdhakjsdhakjdhkjahdkjasdhasjdasjdhaskjd"
                    );

                    // Purchase dataset
                    const hash = await walletClient.writeContract({
                        address: DATASET_CONTRACT_ADDRESS,
                        abi: DatasetTokenABI,
                        functionName: "purchaseDataset",
                        args: [BigInt(dataset.tokenId)],
                        value: dataset.price,
                    });

                    console.log(
                        "asdasdasdsasdasdjaskdhasjkdhakjsdhakjdhkjahdkjasdhasjdasjdhaskjd"
                    );

                    await publicClient.waitForTransactionReceipt({ hash });
                }

                // Fetch dataset from IPFS
                const downloadUrl = await getFromPinata(dataset.ipfsHash);
                const response = await fetch(downloadUrl);
                const data = await response.json();

                results.push({
                    tokenId: dataset.tokenId,
                    data,
                    purchased: !dataset.owned,
                });
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
