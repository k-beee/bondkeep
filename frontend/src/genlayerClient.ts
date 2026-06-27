import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

// Read from env or fallback to a standard deployment placeholder
export const CONTRACT_ADDRESS = (import.meta.env.VITE_BONDKEEP_CONTRACT_ADDRESS || "0x541F5977Fbb35Fb96fe8034CAC8Fc68611e81055") as `0x${string}`;
export const RPC_URL = import.meta.env.VITE_GENLAYER_RPC_URL || "https://studio.genlayer.com/api";

export { generatePrivateKey };

export function getGenLayerClient(privateKey?: string) {
  const account = privateKey ? createAccount(privateKey as `0x${string}`) : undefined;
  return createClient({
    chain: studionet,
    endpoint: RPC_URL,
    account: account,
  });
}
