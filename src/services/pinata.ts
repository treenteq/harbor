import axios from "axios";

const PINATA_API_KEY = process.env.PINATA_API_KEY;
const PINATA_SECRET_KEY = process.env.PINATA_SECRET_KEY;

export const getFromPinata = async (ipfsHash: string): Promise<string> => {
    if (!ipfsHash) {
        throw new Error("IPFS hash is required");
    }
    // Use public gateway for downloads
    return `https://gateway.pinata.cloud/ipfs/${ipfsHash}`;
};
