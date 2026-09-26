import type { MerkleTreePath, WitnessContext } from "@midnight-ntwrk/compact-runtime";
import type { Ledger, Witnesses } from "../managed/VotePointManager/contract/index.js";

/* Private state + witness implementations for VotePointManager (shared by tests and scripts). */
export type VotePointManagerPrivateState = {
    userSecret: Uint8Array;
    forcedGrantPath?: MerkleTreePath<Uint8Array>;
};

export type SettleArgs = {
    tournamentId: bigint;
    itemId: bigint;
    amount: bigint;
    option: Uint8Array;   // optionTag("bet" | "cancel" | "reward")
    deadline: bigint;
    nonce: bigint;        // backend-chosen; replaces the on-chain per-user nonce
};

const GRANT_DEPTH = 16;

function emptyPath(leaf: Uint8Array): MerkleTreePath<Uint8Array> {
    return { leaf, path: Array.from({ length: GRANT_DEPTH }, () => ({ sibling: { field: 0n }, goes_left: false })) };
}

export const witnesses: Witnesses<VotePointManagerPrivateState> = {
    userSecret: ({ privateState }) => [privateState, privateState.userSecret],
    grantPath: ({ ledger, privateState }: WitnessContext<Ledger, VotePointManagerPrivateState>, leaf: Uint8Array) => {
        if (privateState.forcedGrantPath) return [privateState, privateState.forcedGrantPath];
        return [privateState, ledger.grants.findPathForLeaf(leaf) ?? emptyPath(leaf)];
    },
};

