import { Contract, type Ledger, ledger, pureCircuits } from "../../contracts/managed/VotePointManager/contract/index.js";
import { type SettleArgs, type VotePointManagerPrivateState, witnesses } from "../../contracts/witnesses/VotePointManager.witnesses.js";
import type { Wallet } from "../helpers/bytes.js";
import { BaseSimulator } from "./base.sim.js";

export { type SettleArgs, type VotePointManagerPrivateState };

export class VotePointManagerSimulator extends BaseSimulator<VotePointManagerPrivateState> {
    readonly contract: Contract<VotePointManagerPrivateState>;

    private constructor(deployer: Wallet) {
        super(deployer, { userSecret: new Uint8Array(32) });
        this.contract = new Contract<VotePointManagerPrivateState>(witnesses);
    }

    static async deploy(deployer: Wallet, voteSigner: Uint8Array, domainTag: Uint8Array): Promise<VotePointManagerSimulator> {
        const sim = new VotePointManagerSimulator(deployer);
        const res = await sim.contract.initialState(sim.constructorContext(), voteSigner, domainTag);
        sim.state = res.currentContractState.data;
        return sim;
    }

    getLedger(): Ledger {
        return ledger(this.state);
    }

    userPublicKey(secret: Uint8Array): Uint8Array {
        return pureCircuits.userPublicKey(secret);
    }

    settleLeaf(userPk: Uint8Array, a: SettleArgs, tag = this.getLedger().domainTag): Uint8Array {
        return pureCircuits.settleLeaf(tag, userPk, a.tournamentId, a.itemId, a.amount, a.option, a.deadline, a.nonce);
    }

    settleNullifier(secret: Uint8Array, leaf: Uint8Array): Uint8Array {
        return pureCircuits.settleNullifier(secret, leaf);
    }

    async setVoteSigner(newSigner: Uint8Array): Promise<void> {
        this.commit(await this.contract.impureCircuits.setVoteSigner(this.circuitContext("setVoteSigner"), newSigner));
    }

    async setDomainTag(newTag: Uint8Array): Promise<void> {
        this.commit(await this.contract.impureCircuits.setDomainTag(this.circuitContext("setDomainTag"), newTag));
    }

    async grantSettle(leaf: Uint8Array): Promise<void> {
        this.commit(await this.contract.impureCircuits.grantSettle(this.circuitContext("grantSettle"), leaf));
    }

    async settle(a: SettleArgs): Promise<void> {
        this.commit(
            await this.contract.impureCircuits.settle(
                this.circuitContext("settle"),
                a.tournamentId,
                a.itemId,
                a.amount,
                a.option,
                a.deadline,
                a.nonce,
            ),
        );
    }
}
