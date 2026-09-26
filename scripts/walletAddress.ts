import { loadNetwork, requireEnv } from "./lib/config.js";
import { getNetworkId } from "@midnight-ntwrk/midnight-js/network-id";
import * as ledger from "@midnight-ntwrk/ledger-v8";
import { HDWallet, Roles } from "@midnight-ntwrk/wallet-sdk-hd";
import { createKeystore } from "@midnight-ntwrk/wallet-sdk-unshielded-wallet";
import { Buffer } from "node:buffer";

/*
 * Offline: derive the wallet's addresses from MIDNIGHT_WALLET_SEED without syncing.
 *   npx tsx scripts/walletAddress.ts --network preprod
 * unshieldedAddress → paste into https://faucet.preprod.midnight.network/
 * coinPublicKey     → FINALIZE_SIGNER / VOTE_SIGNER when the same wallet acts as operator
 */
loadNetwork();
const hd = HDWallet.fromSeed(Buffer.from(requireEnv("MIDNIGHT_WALLET_SEED"), "hex"));
if (hd.type !== "seedOk") throw new Error("bad seed");
const d = hd.hdWallet.selectAccount(0).selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust]).deriveKeysAt(0);
if (d.type !== "keysDerived") throw new Error("derive failed");
const zswap = ledger.ZswapSecretKeys.fromSeed(d.keys[Roles.Zswap]);
const ks = createKeystore(d.keys[Roles.NightExternal], getNetworkId());
console.log(JSON.stringify({
    network: getNetworkId(),
    unshieldedAddress: ks.getBech32Address().toString(),
    coinPublicKey: String(zswap.coinPublicKey),
}, null, 2));
