import { loadNetwork, requireEnv } from "./lib/config.js";
import { buildWallet } from "./lib/wallet.js";
import { configureProviders, deployTournamentFinalizer, TF_PRIVATE_STATE_ID } from "./lib/contracts.js";
import { writeDeploymentInfo } from "./lib/deployment-info.js";
import { bytes32, isZero, pad32, toHex } from "./lib/bytes.js";
import type { TournamentFinalizerPrivateState } from "../contracts/witnesses/TournamentFinalizer.witnesses.js";

/*
 * Deploy TournamentFinalizer. Mirrors scripts/deploy.ts in the Solidity repo.
 *
 * Env:
 *   MIDNIGHT_WALLET_SEED   deployer wallet seed (hex) — becomes `owner`   (≈ OWNER_KEY)
 *   FINALIZE_SIGNER        operator coin public key, 64 hex chars          (≈ FINALIZE_SIGNER)
 *   FINALIZE_DOMAIN_TAG    ≤32-char domain string, default "pnyx:finalize:v1" (≈ FINALIZE_TYPEHASH)
 *
 *   npx tsx scripts/deploy.ts --network preprod
 */
async function main() {
    const config = loadNetwork();
    const finalizeSigner = bytes32(requireEnv("FINALIZE_SIGNER"), "FINALIZE_SIGNER");
    if (isZero(finalizeSigner)) throw new Error("FINALIZE_SIGNER must be non-zero");
    const domainTagText = process.env.FINALIZE_DOMAIN_TAG ?? "pnyx:finalize:v1";
    const domainTag = pad32(domainTagText);

    const wallet = await buildWallet(config, requireEnv("MIDNIGHT_WALLET_SEED"));
    try {
        const providers = await configureProviders<typeof TF_PRIVATE_STATE_ID, TournamentFinalizerPrivateState>(
            wallet, config, TF_PRIVATE_STATE_ID, "TournamentFinalizer",
        );
        const deployed = await deployTournamentFinalizer(
            providers,
            { userSecret: new Uint8Array(32), voteSalt: new Uint8Array(32) },
            finalizeSigner,
            domainTag,
        );
        const address = deployed.deployTxData.public.contractAddress;
        console.log(`TournamentFinalizer deployed at ${address}`);
        writeDeploymentInfo(config.name, {
            contracts: { tournamentFinalizer: address },
            finalizeSigner: toHex(finalizeSigner),
            domainTags: { tournamentFinalizer: domainTagText },
        });
    } finally {
        await wallet.wallet.stop();
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
