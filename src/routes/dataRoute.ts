import { Router, Request, Response } from "express";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

const router = Router();

// Initialize Viem client
const client = createPublicClient({
    chain: mainnet,
    transport: http(),
});

interface QuoteQueryParams {
    searchParam?: string;
}

// Quote endpoint with search parameter
// router.get(
//     "/quote",
//     async (req: Request<{}, any, any, QuoteQueryParams>, res: Response) => {
//         const { searchParam } = req.query;

//         if (!searchParam) {
//             return res.status(400).json({
//                 success: false,
//                 message: "Search parameter is required",
//             });
//         }

//         try {
//             // Here you can add your smart contract interaction logic
//             // For example:
//             // const data = await client.readContract({...})

//             res.json({
//                 success: true,
//                 searchParam,
//                 // Add your contract data here
//                 message: "Smart contract integration pending",
//             });
//         } catch (error) {
//             console.error("Error fetching quote:", error);
//             res.status(500).json({
//                 success: false,
//                 message:
//                     error instanceof Error
//                         ? error.message
//                         : "An unknown error occurred",
//             });
//         }
//     }
// );

export default router;
