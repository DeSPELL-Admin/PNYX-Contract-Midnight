/*
 * Wallet + provider plumbing for the Midnight scripts.
 *
 * Adapted from midnightntwrk/example-counter (counter-cli/src/api.ts), Copyright (C) Midnight
 * Foundation, Apache-2.0. Trimmed to what the PNYX scripts need: build a wallet from a seed,
 * wait for sync + funds, register NIGHT for DUST, and expose a WalletProvider/MidnightProvider.
 */
import * as ledger from "@midnight-ntwrk/ledger-v8";
import { unshieldedToken } from "@midnight-ntwrk/ledger-v8";
import type { MidnightProvider, WalletProvider } from "@midnight-ntwrk/midnight-js/types";
import { getNetworkId } from "@midnight-ntwrk/midnight-js/network-id";
import { WalletFacade } from "@midnight-ntwrk/wallet-sdk-facade";
import { DustWallet } from "@midnight-ntwrk/wallet-sdk-dust-wallet";
import { HDWallet, Roles } from "@midnight-ntwrk/wallet-sdk-hd";
import { ShieldedWallet } from "@midnight-ntwrk/wallet-sdk-shielded";
import { NoOpTransactionHistoryStorage } from "@midnight-ntwrk/wallet-sdk-abstractions";
import { createKeystore, PublicKey, UnshieldedWallet, type UnshieldedKeystore } from "@midnight-ntwrk/wallet-sdk-unshielded-wallet";
import * as Rx from "rxjs";
import { WebSocket } from "ws";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { scriptsDir, type NetworkConfig } from "./config.js";

/*
 * Sync checkpoint. A fresh preprod wallet needs ~30 min to replay the dust/zswap ledgers, so after
 * every successful sync the three sub-wallet states are serialized to
 * scripts/output/wallet-state-<network>.json and restored on the next run (gitignored).
 */
// MIDNIGHT_CHECKPOINT_TAG: 다른 시드로 실행할 때 오퍼레이터 체크포인트를 오염시키지 않도록 파일을 분리한다.
const checkpointFile = (config: NetworkConfig) => {
    const tag = process.env.MIDNIGHT_CHECKPOINT_TAG ? `-${process.env.MIDNIGHT_CHECKPOINT_TAG}` : "";
    return path.resolve(scriptsDir, "output", `wallet-state-${config.name}${tag}.json`);
};
type Checkpoint = { shielded: string; unshielded: string; dust: string; savedAt: string };

function readCheckpoint(config: NetworkConfig): Checkpoint | undefined {
    const f = checkpointFile(config);
    if (!fs.existsSync(f)) return undefined;
    try {
        return JSON.parse(fs.readFileSync(f, "utf8")) as Checkpoint;
    } catch {
        return undefined;
    }
}

export async function saveCheckpoint(config: NetworkConfig, wallet: WalletFacade): Promise<void> {
    const cp: Checkpoint = {
        shielded: await wallet.shielded.serializeState(),
        unshielded: await wallet.unshielded.serializeState(),
        dust: await wallet.dust.serializeState(),
        savedAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(checkpointFile(config)), { recursive: true });
    fs.writeFileSync(checkpointFile(config), JSON.stringify(cp));
    console.log(`  ✓ wallet sync checkpoint saved (${path.relative(process.cwd(), checkpointFile(config))})`);
}

globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;

export interface WalletContext {
    wallet: WalletFacade;
    shieldedSecretKeys: ledger.ZswapSecretKeys;
    dustSecretKey: ledger.DustSecretKey;
    unshieldedKeystore: UnshieldedKeystore;
}

const deriveKeysFromSeed = (seedHex: string) => {
    const hd = HDWallet.fromSeed(Buffer.from(seedHex, "hex"));
    if (hd.type !== "seedOk") throw new Error("Failed to initialize HDWallet from seed");
    const derived = hd.hdWallet.selectAccount(0).selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust]).deriveKeysAt(0);
    if (derived.type !== "keysDerived") throw new Error("Failed to derive keys");
    hd.hdWallet.clear();
    return derived.keys;
};

// keepAlive: ping the indexer websocket so long preprod syncs are not dropped mid-way.
const indexerConn = ({ indexer, indexerWS }: NetworkConfig) => ({
    indexerClientConnection: { indexerHttpUrl: indexer, indexerWsUrl: indexerWS, keepAlive: 10_000 },
});

export async function withStatus<T>(message: string, fn: () => Promise<T>): Promise<T> {
    process.stdout.write(`  … ${message}`);
    try {
        const r = await fn();
        process.stdout.write(`\r  ✓ ${message}\n`);
        return r;
    } catch (e) {
        process.stdout.write(`\r  ✗ ${message}\n`);
        throw e;
    }
}

const fmtProgress = (label: string, p: { appliedIndex: bigint; highestIndex: bigint; isConnected: boolean }) =>
    `${label} ${p.appliedIndex}/${p.highestIndex}${p.isConnected ? "" : " (disconnected)"}`;

/**
 * "Ready" = unshielded + dust are synced. The shielded (Zswap) wallet holds no coins for these
 * scripts and its full-history sync on preprod takes ~1h and >8 GB, so we do not block on it.
 * Set MIDNIGHT_WAIT_SHIELDED=1 to require the facade's full `isSynced` instead.
 */
const isReady = (s: { isSynced: boolean; unshielded: { progress: { isStrictlyComplete(): boolean } }; dust: { progress: { isStrictlyComplete(): boolean } } }) =>
    process.env.MIDNIGHT_WAIT_SHIELDED === "1" ? s.isSynced : s.unshielded.progress.isStrictlyComplete() && s.dust.progress.isStrictlyComplete();

/** Wait for sync, logging progress every 15s and checkpointing every ~2 min so restarts resume. */
const waitForSync = (wallet: WalletFacade, config?: NetworkConfig) => {
    let ticks = 0;
    return Rx.firstValueFrom(
        wallet.state().pipe(
            Rx.throttleTime(15_000),
            Rx.tap((s) => {
                if (!isReady(s)) {
                    ticks += 1;
                    if (config && ticks % 8 === 0) void saveCheckpoint(config, wallet).catch((e) => console.log(`  (checkpoint skipped: ${e})`));
                    const mem = (process.memoryUsage().rss / 1_073_741_824).toFixed(1);
                    console.log(`    sync ${fmtProgress("shielded", s.shielded.progress)} | unshielded ${s.unshielded.progress.appliedId}/${s.unshielded.progress.highestTransactionId} | dust ${s.dust.progress.appliedIndex}/${s.dust.progress.highestIndex} | rss ${mem}GB`);
                }
            }),
            Rx.filter((s) => isReady(s)),
        ),
    );
};

const waitForFunds = (wallet: WalletFacade): Promise<bigint> =>
    Rx.firstValueFrom(
        wallet.state().pipe(
            Rx.throttleTime(10_000),
            Rx.filter((s) => isReady(s)),
            Rx.map((s) => s.unshielded.balances[unshieldedToken().raw] ?? 0n),
            Rx.filter((b) => b > 0n),
        ),
    );

/** NIGHT must be registered for DUST generation before it can pay fees on preview/preprod. */
async function registerForDustGeneration(wallet: WalletFacade, keystore: UnshieldedKeystore): Promise<void> {
    const state = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => isReady(s))));
    if (state.dust.availableCoins.length > 0 && state.dust.balance(new Date()) > 0n) return;

    const unregistered = state.unshielded.availableCoins.filter((c: any) => c.meta?.registeredForDustGeneration !== true);
    if (unregistered.length > 0) {
        await withStatus(`Registering ${unregistered.length} NIGHT UTXO(s) for DUST generation`, async () => {
            const recipe = await wallet.registerNightUtxosForDustGeneration(unregistered, keystore.getPublicKey(), (p) => keystore.signData(p));
            await wallet.submitTransaction(await wallet.finalizeRecipe(recipe));
        });
    }
    await withStatus("Waiting for DUST to accrue", () =>
        Rx.firstValueFrom(wallet.state().pipe(Rx.throttleTime(5_000), Rx.filter((s) => isReady(s) && s.dust.balance(new Date()) > 0n))),
    );
}

export interface WalletInfo {
    network: string;
    unshieldedAddress: string;
    coinPublicKey: string;
    unshieldedBalance: string;
    dustBalance: string;
    synced: boolean;
}

/** Build + start the wallet and sync, but do not block on funds. */
export async function buildWalletNoWait(config: NetworkConfig, seedHex: string): Promise<WalletContext & { info(): Promise<WalletInfo> }> {
    const ctx = await startWallet(config, seedHex);
    const synced = await withStatus("Syncing with network", () => waitForSync(ctx.wallet, config));
    await saveCheckpoint(config, ctx.wallet);
    return {
        ...ctx,
        async info() {
            const state = await Rx.firstValueFrom(ctx.wallet.state());
            return {
                network: getNetworkId(),
                unshieldedAddress: ctx.unshieldedKeystore.getBech32Address().toString(),
                coinPublicKey: synced.shielded.coinPublicKey.toHexString(),
                unshieldedBalance: String(state.unshielded.balances[unshieldedToken().raw] ?? 0n),
                dustBalance: String(state.dust.balance(new Date())),
                synced: state.isSynced,
            };
        },
    };
}

async function startWallet(config: NetworkConfig, seedHex: string): Promise<WalletContext> {
    return withStatus("Building wallet", async () => {
        const keys = deriveKeysFromSeed(seedHex);
        const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
        const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
        const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());
        const provingServerUrl = new URL(config.proofServer);
        const relayURL = new URL(config.node.replace(/^http/, "ws"));
        const cp = readCheckpoint(config);
        if (cp) console.log(`  ↻ restoring wallet sync checkpoint from ${cp.savedAt}`);
        const wallet = await WalletFacade.init({
            configuration: {
                networkId: getNetworkId(),
                ...indexerConn(config),
                provingServerUrl,
                relayURL,
                txHistoryStorage: new NoOpTransactionHistoryStorage(), // scripts do not need tx history
                costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
                // Default batch size is 10 events → ~700 events/min on preprod (1.4M dust events). Bigger
                // batches amortise the per-batch WASM state update.
                batchUpdates: { size: 2000, timeout: 250 },
            },
            shielded: (cfg) => (cp ? ShieldedWallet(cfg).restore(cp.shielded) : ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys)),
            unshielded: (cfg) => (cp ? UnshieldedWallet(cfg).restore(cp.unshielded) : UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore))),
            dust: (cfg) => (cp ? DustWallet(cfg).restore(cp.dust) : DustWallet(cfg).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust)),
        });
        await wallet.start(shieldedSecretKeys, dustSecretKey);
        return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
    });
}

/**
 * Build a wallet from MIDNIGHT_WALLET_SEED (hex), sync, wait for tNight if empty, ensure DUST.
 * Analogue of hardhat's `accounts: [PRIVATE_KEY]`.
 */
export async function buildWallet(config: NetworkConfig, seedHex: string): Promise<WalletContext> {
    const ctx = await startWallet(config, seedHex);
    console.log(`  unshielded address (fund with tNight): ${ctx.unshieldedKeystore.getBech32Address()}`);
    const synced = await withStatus("Syncing with network", () => waitForSync(ctx.wallet, config));
    await saveCheckpoint(config, ctx.wallet);
    const balance = synced.unshielded.balances[unshieldedToken().raw] ?? 0n;
    if (balance === 0n) {
        await withStatus("Waiting for incoming tNight (https://faucet.preprod.midnight.network/)", () => waitForFunds(ctx.wallet));
    }
    await registerForDustGeneration(ctx.wallet, ctx.unshieldedKeystore);
    await saveCheckpoint(config, ctx.wallet);
    return ctx;
}

/** Sign unshielded intents with the right proof marker (works around a wallet-sdk `signRecipe` bug). */
export function signTransactionIntents(tx: { intents?: Map<number, any> }, signFn: (p: Uint8Array) => ledger.Signature, marker: "proof" | "pre-proof"): void {
    if (!tx.intents || tx.intents.size === 0) return;
    for (const segment of tx.intents.keys()) {
        const intent = tx.intents.get(segment);
        if (!intent) continue;
        const cloned = ledger.Intent.deserialize<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>("signature", marker, "pre-binding", intent.serialize());
        const signature = signFn(cloned.signatureData(segment));
        for (const key of ["fallibleUnshieldedOffer", "guaranteedUnshieldedOffer"] as const) {
            const offer = cloned[key];
            if (offer) {
                const sigs = offer.inputs.map((_: unknown, i: number) => offer.signatures.at(i) ?? signature);
                cloned[key] = offer.addSignatures(sigs);
            }
        }
        tx.intents.set(segment, cloned);
    }
}

export async function createWalletAndMidnightProvider(ctx: WalletContext): Promise<WalletProvider & MidnightProvider> {
    const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => isReady(s))));
    return {
        getCoinPublicKey: () => state.shielded.coinPublicKey.toHexString(),
        getEncryptionPublicKey: () => state.shielded.encryptionPublicKey.toHexString(),
        async balanceTx(tx, ttl?) {
            const recipe = await ctx.wallet.balanceUnboundTransaction(
                tx,
                { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
                { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
            );
            const signFn = (p: Uint8Array) => ctx.unshieldedKeystore.signData(p);
            signTransactionIntents(recipe.baseTransaction, signFn, "proof");
            if (recipe.balancingTransaction) signTransactionIntents(recipe.balancingTransaction, signFn, "pre-proof");
            return ctx.wallet.finalizeRecipe(recipe);
        },
        submitTx: (tx) => ctx.wallet.submitTransaction(tx) as any,
    };
}
