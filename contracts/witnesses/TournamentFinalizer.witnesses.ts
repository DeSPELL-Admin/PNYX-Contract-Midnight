import type { MerkleTreePath, WitnessContext } from "@midnight-ntwrk/compact-runtime";
import { type Ledger, type Witnesses, pureCircuits } from "../managed/TournamentFinalizer/contract/index.js";

/*
 * Private state + witness implementations for TournamentFinalizer.
 * Shared by the vitest simulators and the deployment scripts; a DApp would ship the same
 * `witnesses` object with its own private-state store behind it.
 */
export type VoteRow = { tournamentId: bigint; itemId: bigint; bracketHash: Uint8Array; segment: Uint8Array };
/** What PNYX escrows off-chain for every vote: the committed row + its salt. */
export type EscrowEntry = { row: VoteRow; salt: Uint8Array };

export type TournamentFinalizerPrivateState = {
    /** Per-user secret; derives the user public key, eligibility leaf and vote nullifier. Never leaves the client. */
    userSecret: Uint8Array;
    /** Fresh randomness for the vote commitment. */
    voteSalt: Uint8Array;
    /** Test hook: force the eligibility path witness to return a specific (possibly bogus) path. */
    forcedEligibilityPath?: MerkleTreePath<Uint8Array>;
    /** Operator-side private state: the escrow store the `escrowRows` witness reads from. */
    escrow?: EscrowEntry[];
};

/** Rows per sell proof. Fixed by the circuit (`Vector<ESCROW_BATCH, EscrowRow>`). */
export const ESCROW_BATCH = 8;

export type FinalizeArgs = {
    tournamentId: bigint;
    point: bigint;
    /** LWA final array — [0]=우승, [승,패] 쌍 접힘, 16/32/64개 */
    bracket: bigint[];
    deadline: bigint;
    segment: Uint8Array;
};

const ELIGIBILITY_DEPTH = 16;

/** A syntactically valid but meaningless path — makes the circuit fail its membership assert. */
function emptyPath(leaf: Uint8Array): MerkleTreePath<Uint8Array> {
    return {
        leaf,
        path: Array.from({ length: ELIGIBILITY_DEPTH }, () => ({ sibling: { field: 0n }, goes_left: false })),
    };
}

function emptyEscrowRow() {
    const zero = new Uint8Array(32);
    return {
        present: false,
        row: { tournamentId: 0n, itemId: 0n, bracketHash: zero, segment: zero },
        salt: zero,
        path: emptyPath(zero),
    };
}

export const witnesses: Witnesses<TournamentFinalizerPrivateState> = {
    userSecret: ({ privateState }) => [privateState, privateState.userSecret],
    voteSalt: ({ privateState }) => [privateState, privateState.voteSalt],
    escrowRows: (
        { ledger, privateState }: WitnessContext<Ledger, TournamentFinalizerPrivateState>,
        tournamentId: bigint,
    ) => {
        // 필터 없음: 잘못된 토너먼트의 로우가 섞이면 회로의 WrongTournament assert 가 막는다.
        // (호출자는 tournamentId 의 escrow 만 privateState 에 실어 보낼 책임이 있다 — BE 는 DB 에서 토너먼트별 조회)
        void tournamentId;
        const entries = (privateState.escrow ?? []).slice(0, ESCROW_BATCH);
        const rows = entries.map((e) => {
            const commit = pureCircuits.voteCommitment(e.row, e.salt);
            return { present: true, row: e.row, salt: e.salt, path: ledger.voteCommits.findPathForLeaf(commit) ?? emptyPath(commit) };
        });
        while (rows.length < ESCROW_BATCH) rows.push(emptyEscrowRow());
        return [privateState, rows];
    },
    eligibilityPath: (
        { ledger, privateState }: WitnessContext<Ledger, TournamentFinalizerPrivateState>,
        leaf: Uint8Array,
    ) => {
        if (privateState.forcedEligibilityPath) return [privateState, privateState.forcedEligibilityPath];
        const path = ledger.eligibility.findPathForLeaf(leaf);
        return [privateState, path ?? emptyPath(leaf)];
    },
};

