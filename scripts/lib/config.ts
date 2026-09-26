import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";

dotenv.config();

/*
 * Network configuration. Analogue of the `networks` block in the Solidity repo's
 * hardhat.config.ts. `--network <name>` is mandatory for every script, exactly like hardhat.
 *
 *   standalone  local docker node + indexer + proof server (see example-counter/standalone.yml)
 *   preview     public preview network
 *   preprod     public preprod network — the hackathon target
 *
 * Every URL can be overridden with env vars (MIDNIGHT_INDEXER_URL, MIDNIGHT_INDEXER_WS_URL,
 * MIDNIGHT_NODE_URL, MIDNIGHT_PROOF_SERVER_URL) so a hosted proof server can be plugged in.
 */

export const scriptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const repoDir = path.resolve(scriptsDir, "..");
export const managedDir = path.resolve(repoDir, "contracts", "managed");

export type NetworkName = "standalone" | "preview" | "preprod";

export interface NetworkConfig {
    readonly name: NetworkName;
    readonly indexer: string;
    readonly indexerWS: string;
    readonly node: string;
    readonly proofServer: string;
}

const PRESETS: Record<NetworkName, Omit<NetworkConfig, "name">> = {
    standalone: {
        indexer: "http://127.0.0.1:8088/api/v4/graphql",
        indexerWS: "ws://127.0.0.1:8088/api/v4/graphql/ws",
        node: "http://127.0.0.1:9944",
        proofServer: "http://127.0.0.1:6300",
    },
    preview: {
        indexer: "https://indexer.preview.midnight.network/api/v4/graphql",
        indexerWS: "wss://indexer.preview.midnight.network/api/v4/graphql/ws",
        node: "https://rpc.preview.midnight.network",
        proofServer: "http://127.0.0.1:6300",
    },
    preprod: {
        indexer: "https://indexer.preprod.midnight.network/api/v4/graphql",
        indexerWS: "wss://indexer.preprod.midnight.network/api/v4/graphql/ws",
        node: "https://rpc.preprod.midnight.network",
        proofServer: "http://127.0.0.1:6300",
    },
};

/** Parse `--network <name>` (or MIDNIGHT_NETWORK) and set the global network id. */
export function loadNetwork(argv: string[] = process.argv.slice(2)): NetworkConfig {
    const i = argv.indexOf("--network");
    const raw = i >= 0 ? argv[i + 1] : process.env.MIDNIGHT_NETWORK;
    if (!raw || !(raw in PRESETS)) {
        throw new Error(`--network is required (one of: ${Object.keys(PRESETS).join(", ")})`);
    }
    const name = raw as NetworkName;
    const preset = PRESETS[name];
    setNetworkId(name === "standalone" ? "undeployed" : name);
    return {
        name,
        indexer: process.env.MIDNIGHT_INDEXER_URL ?? preset.indexer,
        indexerWS: process.env.MIDNIGHT_INDEXER_WS_URL ?? preset.indexerWS,
        node: process.env.MIDNIGHT_NODE_URL ?? preset.node,
        proofServer: process.env.MIDNIGHT_PROOF_SERVER_URL ?? preset.proofServer,
    };
}

/** Read a required env var. Same helper (and error style) as the Solidity repo's scripts. */
export function requireEnv(name: string): string {
    const v = process.env[name];
    if (v === undefined || v === "") throw new Error(`Missing required env var: ${name}`);
    return v;
}

/** Positional CLI arg after the flags, e.g. `finalizeTournament.ts --network preprod 7`. */
export function positional(argv: string[] = process.argv.slice(2)): string[] {
    const out: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--network") { i++; continue; }
        out.push(argv[i]);
    }
    return out;
}
