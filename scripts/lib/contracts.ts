import path from "node:path";
import type { ContractAddress } from "@midnight-ntwrk/compact-runtime";
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import { deployContract, findDeployedContract, type DeployedContract, type FoundContract } from "@midnight-ntwrk/midnight-js/contracts";
import type { MidnightProviders } from "@midnight-ntwrk/midnight-js/types";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { Buffer } from "node:buffer";
import * as TF from "../../contracts/managed/TournamentFinalizer/contract/index.js";
import * as VPM from "../../contracts/managed/VotePointManager/contract/index.js";
import { witnesses as tfWitnesses, type TournamentFinalizerPrivateState } from "../../contracts/witnesses/TournamentFinalizer.witnesses.js";
import { witnesses as vpmWitnesses, type VotePointManagerPrivateState } from "../../contracts/witnesses/VotePointManager.witnesses.js";
import { managedDir, type NetworkConfig } from "./config.js";
import { createWalletAndMidnightProvider, type WalletContext } from "./wallet.js";

/*
 * Compiled-contract handles + provider assembly. Analogue of `ethers.getContractFactory` /
 * `ethers.getContractAt` in the Solidity scripts. Each contract gets its own private-state
 * store and zk-config directory (contracts/managed/<Name>).
 */

export const TF_PRIVATE_STATE_ID = "pnyxTournamentFinalizer";
export const VPM_PRIVATE_STATE_ID = "pnyxVotePointManager";

export type TFContract = TF.Contract<TournamentFinalizerPrivateState>;
export type VPMContract = VPM.Contract<VotePointManagerPrivateState>;
export type DeployedTF = DeployedContract<TFContract> | FoundContract<TFContract>;
export type DeployedVPM = DeployedContract<VPMContract> | FoundContract<VPMContract>;

export const tournamentFinalizerCompiled = CompiledContract.make<TFContract>("TournamentFinalizer", TF.Contract).pipe(
    CompiledContract.withWitnesses(tfWitnesses),
    CompiledContract.withCompiledFileAssets(path.resolve(managedDir, "TournamentFinalizer")),
);

export const votePointManagerCompiled = CompiledContract.make<VPMContract>("VotePointManager", VPM.Contract).pipe(
    CompiledContract.withWitnesses(vpmWitnesses),
    CompiledContract.withCompiledFileAssets(path.resolve(managedDir, "VotePointManager")),
);

export type Providers<PSID extends string, PS> = MidnightProviders<string, PSID, PS>;

/** Wire wallet + proof server + indexer + private-state store. */
export async function configureProviders<PSID extends string, PS>(
    ctx: WalletContext,
    config: NetworkConfig,
    privateStateId: PSID,
    contractName: "TournamentFinalizer" | "VotePointManager",
): Promise<Providers<PSID, PS>> {
    const wallet = await createWalletAndMidnightProvider(ctx);
    const zkConfigProvider = new NodeZkConfigProvider<string>(path.resolve(managedDir, contractName));
    const accountId = wallet.getCoinPublicKey();
    const storagePassword = `${Buffer.from(accountId, "hex").toString("base64")}!`;
    return {
        privateStateProvider: levelPrivateStateProvider<PSID>({
            privateStateStoreName: `pnyx-${contractName}-private-state`,
            accountId,
            privateStoragePasswordProvider: () => storagePassword,
        }),
        publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
        zkConfigProvider,
        proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
        walletProvider: wallet,
        midnightProvider: wallet,
    } as Providers<PSID, PS>;
}

// ---------------- TournamentFinalizer ----------------
export async function deployTournamentFinalizer(
    providers: Providers<typeof TF_PRIVATE_STATE_ID, TournamentFinalizerPrivateState>,
    initialPrivateState: TournamentFinalizerPrivateState,
    finalizeSigner: Uint8Array,
    domainTag: Uint8Array,
): Promise<DeployedTF> {
    return deployContract<TFContract>(providers as any, {
        compiledContract: tournamentFinalizerCompiled,
        privateStateId: TF_PRIVATE_STATE_ID,
        initialPrivateState,
        args: [finalizeSigner, domainTag],
    } as any) as Promise<DeployedTF>;
}

export async function joinTournamentFinalizer(
    providers: Providers<typeof TF_PRIVATE_STATE_ID, TournamentFinalizerPrivateState>,
    contractAddress: ContractAddress,
    initialPrivateState: TournamentFinalizerPrivateState,
): Promise<DeployedTF> {
    return findDeployedContract<TFContract>(providers as any, {
        contractAddress,
        compiledContract: tournamentFinalizerCompiled,
        privateStateId: TF_PRIVATE_STATE_ID,
        initialPrivateState,
    } as any) as Promise<DeployedTF>;
}

export async function readTournamentFinalizerLedger(
    providers: Providers<typeof TF_PRIVATE_STATE_ID, TournamentFinalizerPrivateState>,
    contractAddress: ContractAddress,
): Promise<TF.Ledger> {
    const st = await providers.publicDataProvider.queryContractState(contractAddress);
    if (!st) throw new Error(`No TournamentFinalizer contract at ${contractAddress}`);
    return TF.ledger(st.data);
}

// ---------------- VotePointManager ----------------
export async function deployVotePointManager(
    providers: Providers<typeof VPM_PRIVATE_STATE_ID, VotePointManagerPrivateState>,
    initialPrivateState: VotePointManagerPrivateState,
    voteSigner: Uint8Array,
    domainTag: Uint8Array,
): Promise<DeployedVPM> {
    return deployContract<VPMContract>(providers as any, {
        compiledContract: votePointManagerCompiled,
        privateStateId: VPM_PRIVATE_STATE_ID,
        initialPrivateState,
        args: [voteSigner, domainTag],
    } as any) as Promise<DeployedVPM>;
}

export async function joinVotePointManager(
    providers: Providers<typeof VPM_PRIVATE_STATE_ID, VotePointManagerPrivateState>,
    contractAddress: ContractAddress,
    initialPrivateState: VotePointManagerPrivateState,
): Promise<DeployedVPM> {
    return findDeployedContract<VPMContract>(providers as any, {
        contractAddress,
        compiledContract: votePointManagerCompiled,
        privateStateId: VPM_PRIVATE_STATE_ID,
        initialPrivateState,
    } as any) as Promise<DeployedVPM>;
}

export async function readVotePointManagerLedger(
    providers: Providers<typeof VPM_PRIVATE_STATE_ID, VotePointManagerPrivateState>,
    contractAddress: ContractAddress,
): Promise<VPM.Ledger> {
    const st = await providers.publicDataProvider.queryContractState(contractAddress);
    if (!st) throw new Error(`No VotePointManager contract at ${contractAddress}`);
    return VPM.ledger(st.data);
}

export { TF, VPM };
