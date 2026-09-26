import * as Rx from "rxjs";
import { mnemonicToSeedSync } from "@scure/bip39";
import { signatureVerifyingKey } from "@midnight-ntwrk/ledger-v8";
import { loadNetwork } from "./lib/config.js";
import { buildWalletNoWait, signTransactionIntents } from "./lib/wallet.js";

/*
 * Register a wallet's own NIGHT UTXOs for dust generation (the prerequisite for having DUST).
 * Lace 에 등록 버튼이 없을 때 복구 구문으로 직접 실행한다.
 *
 *   USER_WALLET_MNEMONIC="word1 … word24" npx tsx scripts/registerDustSelf.ts --network preprod [expectedAddr]
 *   (또는 USER_WALLET_SEED=<hex>)
 *
 * expectedAddr(mn_addr_…)를 주면 파생된 주소와 일치할 때만 제출한다 — 파생 경로 검증용.
 */
const expected = process.argv.slice(2).filter((a) => a.startsWith("mn_addr_"))[0];

const mnemonic = process.env.USER_WALLET_MNEMONIC?.trim();
const seedHex = mnemonic
    ? Buffer.from(mnemonicToSeedSync(mnemonic)).toString("hex")
    : process.env.USER_WALLET_SEED;
if (!seedHex) throw new Error("set USER_WALLET_MNEMONIC (24 words) or USER_WALLET_SEED (hex) in env/.env");

// 오퍼레이터 지갑 체크포인트와 분리 (시드가 다르므로 상태 공유 금지)
process.env.MIDNIGHT_CHECKPOINT_TAG = process.env.MIDNIGHT_CHECKPOINT_TAG ?? "user";

const config = loadNetwork();
const ctx = await buildWalletNoWait(config, seedHex);
try {
    const myAddr = ctx.unshieldedKeystore.getBech32Address().toString();
    console.log("derived unshielded address:", myAddr);
    if (expected && myAddr !== expected) {
        throw new Error(`주소 불일치 — Lace 주소(${expected.slice(0, 28)}…)와 다르게 파생됨. 시드/파생 경로 확인 필요.`);
    }

    const state = await Rx.firstValueFrom(ctx.wallet.state());
    const coins = state.unshielded.availableCoins;
    console.log(`NIGHT utxos: ${coins.length}`);
    for (const c of coins) console.log(`  value=${c.utxo.value} registered=${c.meta.registeredForDustGeneration}`);
    console.log(`dust balance now: ${state.dust.balance(new Date())}`);

    const unregistered = coins.filter((c) => !c.meta.registeredForDustGeneration).map((c) => ({ utxo: c.utxo, meta: c.meta }));
    if (unregistered.length === 0) { console.log("모든 UTXO 가 이미 등록됨 — 시간이 지나면 DUST 가 생성됩니다."); process.exit(0); }

    const sk = ctx.unshieldedKeystore.getSecretKey().toString("hex");
    const vk = signatureVerifyingKey(sk);
    const sign = (p: Uint8Array) => ctx.unshieldedKeystore.signData(p);

    console.log(`registering ${unregistered.length} utxo(s) → 자기 dust 주소`);
    const re = await ctx.wallet.registerNightUtxosForDustGeneration(unregistered, vk, sign);
    // 등록 tx 의 수수료는 등록되는 UTXO 의 "미래 dust" 로 선지불된다(스펙) — DUST 0 인 새 지갑도
    // 등록할 수 있어야 하므로 기본은 밸런싱 생략. --balance 를 주면 DUST 로 수수료를 붙인다.
    let txToSend = re.transaction;
    if (process.argv.includes("--balance")) {
        const balanced = await ctx.wallet.balanceUnprovenTransaction(
            re.transaction,
            { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
            { ttl: new Date(Date.now() + 30 * 60 * 1000) },
        );
        txToSend = balanced.transaction;
    }
    signTransactionIntents(txToSend as never, (p) => ctx.unshieldedKeystore.signData(p), "pre-proof");
    const fin = await ctx.wallet.finalizeTransaction(txToSend);
    console.log("register tx", await ctx.wallet.submitTransaction(fin));
    console.log("등록 완료 — 이제 DUST 가 생성되기 시작합니다 (Lace 잔액에서 확인)");
} finally {
    await ctx.wallet.stop();
}
