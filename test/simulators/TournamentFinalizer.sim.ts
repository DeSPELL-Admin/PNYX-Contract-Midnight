import { Contract, type Ledger, ledger, pureCircuits } from "../../contracts/managed/TournamentFinalizer/contract/index.js";
import {
    type EscrowEntry,
    type FinalizeArgs,
    type TournamentFinalizerPrivateState,
    type VoteRow,
    ESCROW_BATCH,
    witnesses,
} from "../../contracts/witnesses/TournamentFinalizer.witnesses.js";
import type { Wallet } from "../helpers/bytes.js";
import { BaseSimulator } from "./base.sim.js";

export { ESCROW_BATCH, type EscrowEntry, type FinalizeArgs, type TournamentFinalizerPrivateState, type VoteRow };

export class TournamentFinalizerSimulator extends BaseSimulator<TournamentFinalizerPrivateState> {
    readonly contract: Contract<TournamentFinalizerPrivateState>;

    private constructor(deployer: Wallet) {
        super(deployer, { userSecret: new Uint8Array(32), voteSalt: new Uint8Array(32) });
        this.contract = new Contract<TournamentFinalizerPrivateState>(witnesses);
    }

    static async deploy(deployer: Wallet, finalizeSigner: Uint8Array, domainTag: Uint8Array): Promise<TournamentFinalizerSimulator> {
        const sim = new TournamentFinalizerSimulator(deployer);
        const res = await sim.contract.initialState(sim.constructorContext(), finalizeSigner, domainTag);
        sim.state = res.currentContractState.data;
        return sim;
    }

    getLedger(): Ledger {
        return ledger(this.state);
    }

    // ---- pure helpers (what PNYX-BE computes off-chain) ----
    userPublicKey(secret: Uint8Array): Uint8Array {
        return pureCircuits.userPublicKey(secret);
    }

    bracketHash(bracket: bigint[]): Uint8Array {
        const f = { 16: pureCircuits.bracketHash16, 32: pureCircuits.bracketHash32, 64: pureCircuits.bracketHash64 }[bracket.length];
        if (!f) throw new Error(`unsupported bracket size ${bracket.length}`);
        return f(bracket);
    }

    eligibilityLeaf(userPk: Uint8Array, tournamentId: bigint, point: bigint, deadline: bigint, bracket: bigint[], tag = this.getLedger().domainTag): Uint8Array {
        return pureCircuits.eligibilityLeaf(tag, userPk, tournamentId, point, deadline, this.bracketHash(bracket));
    }

    voteNullifier(secret: Uint8Array, tournamentId: bigint): Uint8Array {
        return pureCircuits.voteNullifier(secret, tournamentId);
    }

    // ---- circuits ----
    async setFinalizeSigner(newSigner: Uint8Array): Promise<void> {
        this.commit(await this.contract.impureCircuits.setFinalizeSigner(this.circuitContext("setFinalizeSigner"), newSigner));
    }

    async setDomainTag(newTag: Uint8Array): Promise<void> {
        this.commit(await this.contract.impureCircuits.setDomainTag(this.circuitContext("setDomainTag"), newTag));
    }

    async grantEligibility(leaf: Uint8Array): Promise<void> {
        this.commit(await this.contract.impureCircuits.grantEligibility(this.circuitContext("grantEligibility"), leaf));
    }

    // ---- data market ----
    async registerBuyer(buyerPk: Uint8Array): Promise<void> {
        this.commit(await this.contract.impureCircuits.registerBuyer(this.circuitContext("registerBuyer"), buyerPk));
    }

    async sellRows(buyerPk: Uint8Array, tournamentId: bigint, specHash: Uint8Array, datasetHash: Uint8Array): Promise<void> {
        this.commit(await this.contract.impureCircuits.sellRows(this.circuitContext("sellRows"), buyerPk, tournamentId, specHash, datasetHash));
    }

    licenseId(buyerPk: Uint8Array, tournamentId: bigint, specHash: Uint8Array): Uint8Array {
        return pureCircuits.licenseId(buyerPk, tournamentId, specHash);
    }

    voteCommitment(row: VoteRow, salt: Uint8Array): Uint8Array {
        return pureCircuits.voteCommitment(row, salt);
    }

    async finalizeTournament(a: FinalizeArgs): Promise<void> {
        const name = `finalizeTournament${a.bracket.length}` as "finalizeTournament16" | "finalizeTournament32" | "finalizeTournament64";
        this.commit(
            await this.contract.impureCircuits[name](
                this.circuitContext(name),
                a.tournamentId,
                a.point,
                a.deadline,
                a.bracket,
                a.segment,
            ),
        );
    }
}
