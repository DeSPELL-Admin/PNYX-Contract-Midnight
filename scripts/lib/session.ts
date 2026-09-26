import { loadNetwork, requireEnv, type NetworkConfig } from "./config.js";
import { buildWallet, type WalletContext } from "./wallet.js";
import {
    configureProviders,
    joinTournamentFinalizer,
    joinVotePointManager,
    TF_PRIVATE_STATE_ID,
    VPM_PRIVATE_STATE_ID,
    type DeployedTF,
    type DeployedVPM,
    type Providers,
} from "./contracts.js";
import { requireContractAddress } from "./deployment-info.js";
import { bytes32 } from "./bytes.js";
import type { TournamentFinalizerPrivateState } from "../../contracts/witnesses/TournamentFinalizer.witnesses.js";
import type { VotePointManagerPrivateState } from "../../contracts/witnesses/VotePointManager.witnesses.js";

/*
 * One-call session setup for the interaction scripts:
 *   network → wallet (MIDNIGHT_WALLET_SEED) → providers → join the deployed contract.
 *
 * Private state comes from env so the same script can act as a user (USER_SECRET / VOTE_SALT)
 * or as the operator (no secret needed; escrow rows are loaded by the data-market scripts).
 */

export interface Session {
    config: NetworkConfig;
    wallet: WalletContext;
}

export async function openSession(): Promise<Session> {
    const config = loadNetwork();
    const wallet = await buildWallet(config, requireEnv("MIDNIGHT_WALLET_SEED"));
    return { config, wallet };
}

export async function closeSession(s: Session): Promise<void> {
    await s.wallet.wallet.stop();
}

export function userPrivateState(): TournamentFinalizerPrivateState {
    return {
        userSecret: bytes32(process.env.USER_SECRET ?? "00".repeat(32), "USER_SECRET"),
        voteSalt: bytes32(process.env.VOTE_SALT ?? "00".repeat(32), "VOTE_SALT"),
    };
}

export function votePrivateState(): VotePointManagerPrivateState {
    return { userSecret: bytes32(process.env.USER_SECRET ?? "00".repeat(32), "USER_SECRET") };
}

export async function tournamentFinalizerSession(ps: TournamentFinalizerPrivateState = userPrivateState()) {
    const s = await openSession();
    const providers: Providers<typeof TF_PRIVATE_STATE_ID, TournamentFinalizerPrivateState> = await configureProviders(
        s.wallet, s.config, TF_PRIVATE_STATE_ID, "TournamentFinalizer",
    );
    const address = requireContractAddress(s.config.name, "tournamentFinalizer");
    const contract: DeployedTF = await joinTournamentFinalizer(providers, address, ps);
    return { ...s, providers, address, contract };
}

export async function votePointManagerSession(ps: VotePointManagerPrivateState = votePrivateState()) {
    const s = await openSession();
    const providers: Providers<typeof VPM_PRIVATE_STATE_ID, VotePointManagerPrivateState> = await configureProviders(
        s.wallet, s.config, VPM_PRIVATE_STATE_ID, "VotePointManager",
    );
    const address = requireContractAddress(s.config.name, "votePointManager");
    const contract: DeployedVPM = await joinVotePointManager(providers, address, ps);
    return { ...s, providers, address, contract };
}

export function logTx(label: string, tx: { public: { txId: string; blockHeight: bigint | number } }): void {
    console.log(`${label}: tx ${tx.public.txId} @ block ${tx.public.blockHeight}`);
}
