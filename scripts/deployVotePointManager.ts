import { loadNetwork, requireEnv } from "./lib/config.js";
import { buildWallet } from "./lib/wallet.js";
import { configureProviders, deployVotePointManager, VPM_PRIVATE_STATE_ID } from "./lib/contracts.js";
import { writeDeploymentInfo } from "./lib/deployment-info.js";
import { bytes32, isZero, pad32, toHex } from "./lib/bytes.js";
import type { VotePointManagerPrivateState } from "../contracts/witnesses/VotePointManager.witnesses.js";

/*
 * Deploy VotePointManager. Mirrors scripts/deployVotePointManager.ts in the Solidity repo.
 * Env: MIDNIGHT_WALLET_SEED, VOTE_SIGNER (64 hex), VOTE_DOMAIN_TAG (default "pnyx:vote:v1").
 */
async function main() {
    const config = loadNetwork();
    const voteSigner = bytes32(requireEnv("VOTE_SIGNER"), "VOTE_SIGNER");
    if (isZero(voteSigner)) throw new Error("VOTE_SIGNER must be non-zero");
    const domainTagText = process.env.VOTE_DOMAIN_TAG ?? "pnyx:vote:v1";

    const wallet = await buildWallet(config, requireEnv("MIDNIGHT_WALLET_SEED"));
    try {
        const providers = await configureProviders<typeof VPM_PRIVATE_STATE_ID, VotePointManagerPrivateState>(
            wallet, config, VPM_PRIVATE_STATE_ID, "VotePointManager",
        );
        const deployed = await deployVotePointManager(providers, { userSecret: new Uint8Array(32) }, voteSigner, pad32(domainTagText));
        const address = deployed.deployTxData.public.contractAddress;
        console.log(`VotePointManager deployed at ${address}`);
        writeDeploymentInfo(config.name, {
            contracts: { votePointManager: address },
            voteSigner: toHex(voteSigner),
            domainTags: { votePointManager: domainTagText },
        });
    } finally {
        await wallet.wallet.stop();
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
