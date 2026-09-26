import {
    type CircuitContext,
    type CircuitResults,
    type ChargedState,
    type StateValue,
    createCircuitContext,
    createConstructorContext,
    sampleContractAddress,
} from "@midnight-ntwrk/compact-runtime";
import type { Wallet } from "../helpers/bytes.js";

/**
 * Shared simulator plumbing. Mirrors the hardhat `loadFixture` + `connect(signer)` pattern:
 * - `deploy()` runs the constructor as `deployer`
 * - `as(wallet)` switches the caller (msg.sender analogue = Zswap coin public key)
 * - `at(seconds)` sets the block time the kernel sees (for deadline checks)
 *
 * Each circuit call builds a fresh CircuitContext from the persisted ledger state, so the
 * simulator behaves like a single deployed contract that many wallets interact with.
 */
export abstract class BaseSimulator<PS> {
    protected state!: ChargedState | StateValue;
    protected caller: Wallet;
    protected privateState: PS;
    protected time = 1_700_000_000; // fixed "now" so tests are deterministic
    readonly address = sampleContractAddress();

    protected constructor(deployer: Wallet, privateState: PS) {
        this.caller = deployer;
        this.privateState = privateState;
    }

    protected constructorContext() {
        return createConstructorContext(this.privateState, this.caller.hex);
    }

    protected circuitContext(circuitId: string): CircuitContext<PS> {
        // compact-runtime 0.16: (address, coinPublicKey, contractState, privateState, gasLimit?, costModel?, time?)
        void circuitId;
        return createCircuitContext<PS>(this.address, this.caller.hex, this.state, this.privateState, undefined, undefined, this.time);
    }

    /** Persist ledger + private state after a successful circuit run. */
    protected commit<R>(res: CircuitResults<PS, R>): R {
        this.state = res.context.currentQueryContext.state;
        if (res.context.currentPrivateState !== undefined) {
            this.privateState = res.context.currentPrivateState;
        }
        return res.result;
    }

    as(wallet: Wallet): this {
        this.caller = wallet;
        return this;
    }

    withPrivateState(ps: PS): this {
        this.privateState = ps;
        return this;
    }

    at(seconds: number): this {
        this.time = seconds;
        return this;
    }

    now(): number {
        return this.time;
    }
}
