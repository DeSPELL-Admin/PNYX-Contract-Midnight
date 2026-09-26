import { loadNetwork, requireEnv } from "./lib/config.js";
import { buildWalletNoWait } from "./lib/wallet.js";

/*
 * Print the wallet's addresses without waiting for funds — use it to (1) get the unshielded
 * address for the faucet and (2) get the coin public key to use as FINALIZE_SIGNER / VOTE_SIGNER.
 *   npx tsx scripts/walletInfo.ts --network preprod
 */
const config = loadNetwork();
const ctx = await buildWalletNoWait(config, requireEnv("MIDNIGHT_WALLET_SEED"));
try {
    console.log(JSON.stringify(await ctx.info(), null, 2));
} finally {
    await ctx.wallet.stop();
}
