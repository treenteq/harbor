declare module "@services/pinata" {
    export function getFromPinata(ipfsHash: string): Promise<string>;
}
