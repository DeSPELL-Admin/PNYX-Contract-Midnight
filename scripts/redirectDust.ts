import * as Rx from "rxjs";
import { signData, signatureVerifyingKey } from "@midnight-ntwrk/ledger-v8";
import { DustAddress, MidnightBech32m } from "@midnight-ntwrk/wallet-sdk-address-format";
import { loadNetwork, positional, requireEnv } from "./lib/config.js";
import { buildWalletNoWait, signTransactionIntents } from "./lib/wallet.js";

/*
 * Redirect the operator's NIGHT dust generation to another wallet's dust address.
 * DUST itself is non-transferable; what CAN move is who receives the generation.
 *   npx tsx scripts/redirectDust.ts --network preprod <mn_dust_...> [--dry]
 */
const [dustAddrStr] = positional();
const dry = process.argv.includes("--dry");
if (!dustAddrStr?.startsWith("mn_dust_")) throw new Error("usage: redirectDust.ts --network <n> <mn_dust_...> [--dry]");

const config = loadNetwork();
const ctx = await buildWalletNoWait(config, requireEnv("MIDNIGHT_WALLET_SEED"));

/** 수수료(DUST) 밸런싱 → unshielded intent 서명 → 증명 → 제출. */
async function submitRecipe(tx: import("@midnight-ntwrk/ledger-v8").UnprovenTransaction): Promise<string> {
    const recipe = await ctx.wallet.balanceUnprovenTransaction(
        tx,
        { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
        { ttl: new Date(Date.now() + 30 * 60 * 1000) },
    );
    const signFn = (p: Uint8Array) => ctx.unshieldedKeystore.signData(p);
    // UnprovenTransactionRecipe = { type, transaction } — 밸런싱 결과 tx 하나에 서명 후 증명·제출
    signTransactionIntents(recipe.transaction as never, signFn, "pre-proof");
    const fin = await ctx.wallet.finalizeTransaction(recipe.transaction);
    return await ctx.wallet.submitTransaction(fin);
}
try {
    const receiver = MidnightBech32m.parse(dustAddrStr).decode(DustAddress, "preprod");
    const state = await Rx.firstValueFrom(ctx.wallet.state());
    const coins = state.unshielded.availableCoins;
    console.log(`operator NIGHT utxos: ${coins.length}`);
    for (const c of coins) console.log(`  value=${c.utxo.value} registered=${c.meta.registeredForDustGeneration}`);
    if (dry) process.exit(0);

    const sk = ctx.unshieldedKeystore.getSecretKey().toString("hex");
    const vk = signatureVerifyingKey(sk);
    const sign = (payload: Uint8Array) => signData(sk, payload);

    // 이미 등록된 UTXO 는 수신자를 바꾸려면 해제 후 재등록해야 한다.
    const registered = coins.filter((c) => c.meta.registeredForDustGeneration).map((c) => ({ utxo: c.utxo, meta: c.meta }));
    if (registered.length > 0) {
        console.log(`deregistering ${registered.length} utxo(s)…`);
        const de = await ctx.wallet.deregisterFromDustGeneration(registered, vk, sign);
        console.log("deregister tx", await submitRecipe(de.transaction));
        console.log("(주의: 해제 tx 확정 후 다시 실행하면 재등록됩니다)");
        process.exit(0);
    }

    const all = coins.map((c) => ({ utxo: c.utxo, meta: c.meta }));
    console.log(`registering ${all.length} utxo(s) → ${dustAddrStr.slice(0, 24)}…`);
    const re = await ctx.wallet.registerNightUtxosForDustGeneration(all, vk, sign, receiver);
    console.log("register tx", await submitRecipe(re.transaction));
} finally {
    await ctx.wallet.stop();
}
