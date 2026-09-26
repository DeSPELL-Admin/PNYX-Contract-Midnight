import { loadNetwork, requireEnv } from "./lib/config.js";
import { getNetworkId } from "@midnight-ntwrk/midnight-js/network-id";
import { NoOpTransactionHistoryStorage } from "@midnight-ntwrk/wallet-sdk-abstractions";
import { HDWallet, Roles } from "@midnight-ntwrk/wallet-sdk-hd";
import { createKeystore, PublicKey, UnshieldedWallet } from "@midnight-ntwrk/wallet-sdk-unshielded-wallet";
import * as Rx from "rxjs";
import { WebSocket } from "ws";
import { Buffer } from "node:buffer";
globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;

/* Debug: sync only the unshielded wallet and print its progress/errors. */
const config = loadNetwork();
const hd = HDWallet.fromSeed(Buffer.from(requireEnv("MIDNIGHT_WALLET_SEED"), "hex"));
if (hd.type !== "seedOk") throw new Error("bad seed");
const d = hd.hdWallet.selectAccount(0).selectRoles([Roles.NightExternal]).deriveKeysAt(0);
if (d.type !== "keysDerived") throw new Error("derive failed");
const ks = createKeystore(d.keys[Roles.NightExternal], getNetworkId());
const w = UnshieldedWallet({
    networkId: getNetworkId(),
    indexerClientConnection: { indexerHttpUrl: config.indexer, indexerWsUrl: config.indexerWS, keepAlive: 10_000 },
    txHistoryStorage: new NoOpTransactionHistoryStorage(),
} as any).startWithPublicKey(PublicKey.fromKeyStore(ks));
await w.start();
const sub = w.state.pipe(Rx.throttleTime(5_000)).subscribe((s: any) => {
    console.log(`unshielded ${s.progress.appliedId}/${s.progress.highestTransactionId} connected=${s.progress.isConnected} synced=${s.progress.isStrictlyComplete?.()} balance=${Object.entries(s.balances).map(([k,v])=>k.slice(0,8)+":"+String(v)).join(",")}`);
});
setTimeout(async () => { sub.unsubscribe(); await w.stop(); process.exit(0); }, 240_000);
