import { unshieldedToken } from "@midnight-ntwrk/ledger-v8";
import { UnshieldedAddress, MidnightBech32m } from "@midnight-ntwrk/wallet-sdk-address-format";
import { loadNetwork, positional, requireEnv } from "./lib/config.js";
import { buildWalletNoWait, signTransactionIntents } from "./lib/wallet.js";

/*
 * Send unshielded tNIGHT from the operator wallet.
 *   npx tsx scripts/sendNight.ts --network preprod <mn_addr_...> <amountUnits>
 */
const [addrStr, amountStr] = positional();
if (!addrStr?.startsWith("mn_addr_") || !amountStr) throw new Error("usage: sendNight.ts --network <n> <mn_addr_...> <amountUnits>");

const config = loadNetwork();
const ctx = await buildWalletNoWait(config, requireEnv("MIDNIGHT_WALLET_SEED"));
try {
    const receiver = MidnightBech32m.parse(addrStr).decode(UnshieldedAddress as never, "preprod" as never) as InstanceType<typeof UnshieldedAddress>;
    const recipe = await ctx.wallet.transferTransaction(
        [{ type: "unshielded", outputs: [{ type: unshieldedToken().raw, receiverAddress: receiver, amount: BigInt(amountStr) }] }],
        { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
        { ttl: new Date(Date.now() + 30 * 60 * 1000), payFees: true },
    );
    // 수수료(DUST) 밸런싱 → intent 서명 → 증명 → 제출 (redirectDust 와 동일한 검증된 플로우)
    const balanced = await ctx.wallet.balanceUnprovenTransaction(
        (recipe as never as { transaction: never }).transaction,
        { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
        { ttl: new Date(Date.now() + 30 * 60 * 1000) },
    );
    const signFn = (p: Uint8Array) => ctx.unshieldedKeystore.signData(p);
    signTransactionIntents(balanced.transaction as never, signFn, "pre-proof");
    const fin = await ctx.wallet.finalizeTransaction(balanced.transaction);
    console.log("sendNight tx", await ctx.wallet.submitTransaction(fin));
} finally {
    await ctx.wallet.stop();
}
