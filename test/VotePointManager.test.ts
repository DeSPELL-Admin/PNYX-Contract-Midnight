import { describe, it, expect, beforeEach } from "vitest";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { VotePointManagerSimulator, type SettleArgs, type VotePointManagerPrivateState } from "./simulators/VotePointManager.sim.js";
import { ZERO_BYTES32, makeWallet, optionTag, pad32, randomBytes, type Wallet } from "./helpers/bytes.js";

setNetworkId("undeployed");

// Domain tag baked in at deploy time — analogue of the EIP-712 Vote type string.
const DOMAIN_TAG = pad32("pnyx:vote:v1");
const OPTIONS = ["bet", "cancel", "reward"] as const;
const MAX_UINT128 = (1n << 128n) - 1n;

type User = { wallet: Wallet; ps: VotePointManagerPrivateState };
function makeUser(): User {
    return { wallet: makeWallet(), ps: { userSecret: randomBytes(32) } };
}

async function deployVotePointManagerFixture() {
    const owner = makeWallet();
    const signer = makeWallet();
    const other = makeWallet();
    const caller = makeUser();
    const votePointManager = await VotePointManagerSimulator.deploy(owner, signer.bytes, DOMAIN_TAG);
    return { votePointManager, owner, caller, signer, other };
}
type Fixture = Awaited<ReturnType<typeof deployVotePointManagerFixture>>;

function baseArgs(sim: VotePointManagerSimulator, over: Partial<SettleArgs> = {}): SettleArgs {
    return {
        tournamentId: 7n,
        itemId: 3n,
        amount: 1_000n,
        option: optionTag("bet"),
        deadline: BigInt(sim.now() + 3600),
        nonce: 0n,
        ...over,
    };
}

/** Backend flow: derive the grant leaf for the user + intent and insert it as `signer`. */
async function grantFor(f: Fixture, user: User, a: SettleArgs, by: Wallet = f.signer): Promise<Uint8Array> {
    const pk = f.votePointManager.userPublicKey(user.ps.userSecret);
    const leaf = f.votePointManager.settleLeaf(pk, a);
    await f.votePointManager.as(by).grantSettle(leaf);
    return leaf;
}

async function settleAs(f: Fixture, user: User, a: SettleArgs): Promise<void> {
    await f.votePointManager.as(user.wallet).withPrivateState(user.ps).settle(a);
}

describe("VotePointManager", function () {
    let f: Fixture;
    beforeEach(async () => {
        f = await deployVotePointManagerFixture();
    });

    describe("settle (happy path)", function () {
        for (const option of OPTIONS) {
            it(`verifies a valid "${option}" grant, records the Settled entry, and consumes the nullifier`, async function () {
                const a = baseArgs(f.votePointManager, { option: optionTag(option) });
                const leaf = await grantFor(f, f.caller, a);
                await settleAs(f, f.caller, a);

                const l = f.votePointManager.getLedger();
                const nul = f.votePointManager.settleNullifier(f.caller.ps.userSecret, leaf);
                expect(l.settledCount).toEqual(1n);
                expect(l.nullifiers.member(nul)).toBe(true);
                const s = l.settlements.lookup(nul);
                expect(s.user).toEqual(f.votePointManager.userPublicKey(f.caller.ps.userSecret));
                expect(s.tournamentId).toEqual(a.tournamentId);
                expect(s.itemId).toEqual(a.itemId);
                expect(s.amount).toEqual(a.amount);
                expect(s.option).toEqual(optionTag(option));
            });
        }

        it("derives the grant leaf deterministically (cross-check with pureCircuits)", async function () {
            const a = baseArgs(f.votePointManager);
            const pk = f.votePointManager.userPublicKey(f.caller.ps.userSecret);
            expect(f.votePointManager.settleLeaf(pk, a)).toEqual(f.votePointManager.settleLeaf(pk, a));
            expect(f.votePointManager.settleLeaf(pk, a)).not.toEqual(f.votePointManager.settleLeaf(pk, { ...a, nonce: 1n }));
        });

        it("allows distinct users to settle with their own nullifiers", async function () {
            const a = baseArgs(f.votePointManager);
            const u2 = makeUser();
            await grantFor(f, f.caller, a);
            await grantFor(f, u2, a);
            await settleAs(f, f.caller, a);
            await settleAs(f, u2, a);
            expect(f.votePointManager.getLedger().settledCount).toEqual(2n);
        });
    });

    describe("settle (rejections)", function () {
        it("reverts with ExpiredSignature when the deadline has passed", async function () {
            const a = baseArgs(f.votePointManager, { deadline: BigInt(f.votePointManager.now() - 1) });
            await grantFor(f, f.caller, a);
            await expect(settleAs(f, f.caller, a)).rejects.toThrow("ExpiredSignature");
        });

        it("reverts with NotSigner when granted by an unauthorized account", async function () {
            const a = baseArgs(f.votePointManager);
            await expect(grantFor(f, f.caller, a, f.other)).rejects.toThrow("NotSigner");
        });

        it("reverts with InvalidSigner when the caller differs from the granted user", async function () {
            const a = baseArgs(f.votePointManager);
            await grantFor(f, f.caller, a);
            await expect(settleAs(f, makeUser(), a)).rejects.toThrow("InvalidSigner");
        });

        for (const [field, mutate] of [
            ["itemId", (a: SettleArgs) => ({ ...a, itemId: a.itemId + 1n })],
            ["amount", (a: SettleArgs) => ({ ...a, amount: a.amount + 1n })],
            ["tournamentId", (a: SettleArgs) => ({ ...a, tournamentId: a.tournamentId + 1n })],
            ["nonce", (a: SettleArgs) => ({ ...a, nonce: a.nonce + 1n })],
            ["deadline", (a: SettleArgs) => ({ ...a, deadline: a.deadline + 1n })],
        ] as const) {
            it(`reverts with InvalidSigner when the ${field} is tampered after granting`, async function () {
                const a = baseArgs(f.votePointManager);
                await grantFor(f, f.caller, a);
                await expect(settleAs(f, f.caller, mutate(a))).rejects.toThrow("InvalidSigner");
            });
        }

        it("prevents replay: reusing the same grant reverts (nullifier already consumed)", async function () {
            const a = baseArgs(f.votePointManager);
            await grantFor(f, f.caller, a);
            await settleAs(f, f.caller, a);
            await expect(settleAs(f, f.caller, a)).rejects.toThrow("NonceConsumed");
        });

        it("reverts on a malformed grant path", async function () {
            const a = baseArgs(f.votePointManager);
            const leaf = await grantFor(f, f.caller, a);
            const bogus: User = { ...f.caller, ps: { ...f.caller.ps, forcedGrantPath: { leaf, path: Array.from({ length: 16 }, () => ({ sibling: { field: 1n }, goes_left: true })) } } };
            await expect(settleAs(f, bogus, a)).rejects.toThrow("InvalidSigner");
        });
    });

    describe("settle (option integrity — cross-use blocked)", function () {
        it("reverts with InvalidSigner when a 'bet' grant is submitted as 'reward'", async function () {
            const a = baseArgs(f.votePointManager, { option: optionTag("bet") });
            await grantFor(f, f.caller, a);
            await expect(settleAs(f, f.caller, { ...a, option: optionTag("reward") })).rejects.toThrow("InvalidSigner");
        });

        it('reverts with InvalidSigner when the option casing differs ("Bet" vs "bet")', async function () {
            const a = baseArgs(f.votePointManager, { option: optionTag("bet") });
            await grantFor(f, f.caller, a);
            await expect(settleAs(f, f.caller, { ...a, option: optionTag("Bet") })).rejects.toThrow("InvalidSigner");
        });
    });

    describe("settle (edge cases — no on-chain value validation)", function () {
        it("processes zero tournamentId / itemId / amount normally", async function () {
            const a = baseArgs(f.votePointManager, { tournamentId: 0n, itemId: 0n, amount: 0n });
            await grantFor(f, f.caller, a);
            await settleAs(f, f.caller, a);
            expect(f.votePointManager.getLedger().settledCount).toEqual(1n);
        });

        it("accepts an empty option", async function () {
            const a = baseArgs(f.votePointManager, { option: optionTag("") });
            await grantFor(f, f.caller, a);
            await settleAs(f, f.caller, a);
            expect(f.votePointManager.getLedger().settledCount).toEqual(1n);
        });

        it("accepts a max-uint128 amount and a long option string", async function () {
            const a = baseArgs(f.votePointManager, { amount: MAX_UINT128, option: optionTag("x".repeat(200)) });
            await grantFor(f, f.caller, a);
            await settleAs(f, f.caller, a);
            const leaf = f.votePointManager.settleLeaf(f.votePointManager.userPublicKey(f.caller.ps.userSecret), a);
            const s = f.votePointManager.getLedger().settlements.lookup(f.votePointManager.settleNullifier(f.caller.ps.userSecret, leaf));
            expect(s.amount).toEqual(MAX_UINT128);
        });
    });

    describe("setVoteSigner", function () {
        it("lets the owner update the signer", async function () {
            await f.votePointManager.as(f.owner).setVoteSigner(f.other.bytes);
            expect(f.votePointManager.getLedger().voteSigner).toEqual(f.other.bytes);
        });

        it("makes grants from the new signer pass and the old signer fail", async function () {
            await f.votePointManager.as(f.owner).setVoteSigner(f.other.bytes);
            const a = baseArgs(f.votePointManager);
            await expect(grantFor(f, f.caller, a, f.signer)).rejects.toThrow("NotSigner");
            await grantFor(f, f.caller, a, f.other);
            await settleAs(f, f.caller, a);
            expect(f.votePointManager.getLedger().settledCount).toEqual(1n);
        });

        it("reverts for a non-owner", async function () {
            await expect(f.votePointManager.as(f.other).setVoteSigner(f.other.bytes)).rejects.toThrow("NotOwner");
        });

        it("reverts on the zero address", async function () {
            await expect(f.votePointManager.as(f.owner).setVoteSigner(ZERO_BYTES32)).rejects.toThrow("ZeroAddress");
        });

        it("reverts when set to the current signer (ValueUnchanged)", async function () {
            await expect(f.votePointManager.as(f.owner).setVoteSigner(f.signer.bytes)).rejects.toThrow("ValueUnchanged");
        });
    });

    describe("setDomainTag", function () {
        it("lets the owner update the domain tag", async function () {
            await f.votePointManager.as(f.owner).setDomainTag(pad32("pnyx:vote:v2"));
            expect(f.votePointManager.getLedger().domainTag).toEqual(pad32("pnyx:vote:v2"));
        });

        it("makes the original grant invalid after the domain tag changes", async function () {
            const a = baseArgs(f.votePointManager);
            await grantFor(f, f.caller, a);
            await f.votePointManager.as(f.owner).setDomainTag(pad32("pnyx:vote:v2"));
            await expect(settleAs(f, f.caller, a)).rejects.toThrow("InvalidSigner");
        });

        it("reverts for a non-owner", async function () {
            await expect(f.votePointManager.as(f.other).setDomainTag(pad32("x"))).rejects.toThrow("NotOwner");
        });

        it("reverts when the domain tag is unchanged (ValueUnchanged)", async function () {
            await expect(f.votePointManager.as(f.owner).setDomainTag(DOMAIN_TAG)).rejects.toThrow("ValueUnchanged");
        });
    });

    describe("settle (load)", function () {
        it("processes many sequential settles from one caller with a monotonically increasing nonce", async function () {
            const N = 20;
            for (let i = 0; i < N; i++) {
                const a = baseArgs(f.votePointManager, { nonce: BigInt(i), amount: BigInt(10 * (i + 1)) });
                await grantFor(f, f.caller, a);
                await settleAs(f, f.caller, a);
            }
            expect(f.votePointManager.getLedger().settledCount).toEqual(BigInt(N));
        });
    });
});
