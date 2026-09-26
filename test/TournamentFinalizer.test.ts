import { describe, it, expect, beforeEach } from "vitest";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { TournamentFinalizerSimulator, type FinalizeArgs, type TournamentFinalizerPrivateState } from "./simulators/TournamentFinalizer.sim.js";
import { ZERO_BYTES32, makeWallet, pad32, randomBytes, type Wallet } from "./helpers/bytes.js";

setNetworkId("undeployed");

// Domain tag baked into the contract at deploy time — the Midnight analogue of the EIP-712
// type string. MUST match what PNYX-BE uses when deriving eligibility leaves.
const DOMAIN_TAG = pad32("pnyx:finalize:v1");


/** A "user" = wallet (tx submitter) + private state (userSecret / voteSalt). */
type User = { wallet: Wallet; ps: TournamentFinalizerPrivateState };
function makeUser(): User {
    return { wallet: makeWallet(), ps: { userSecret: randomBytes(32), voteSalt: randomBytes(32) } };
}

async function deployTournamentFinalizerFixture() {
    const owner = makeWallet();
    const signer = makeWallet(); // authorized backend operator — grants eligibility (EIP-712 signer analogue)
    const other = makeWallet();
    const caller = makeUser();

    const tournamentFinalizer = await TournamentFinalizerSimulator.deploy(owner, signer.bytes, DOMAIN_TAG);
    return { tournamentFinalizer, owner, caller, signer, other };
}

type Fixture = Awaited<ReturnType<typeof deployTournamentFinalizerFixture>>;

function futureDeadline(sim: TournamentFinalizerSimulator, secondsAhead = 3600): bigint {
    return BigInt(sim.now() + secondsAhead);
}

/** 우승자를 champion 으로 하는 브라켓(기본 16강) — [승,패] 쌍 접힘, 나머지 슬롯은 서로 다른 id */
function bracketFor(champion: bigint, size = 16): bigint[] {
    const others: bigint[] = [];
    for (let i = 10n; others.length < size - 1; i++) if (i !== champion) others.push(i);
    return [champion, ...others];
}

function baseArgs(sim: TournamentFinalizerSimulator, over: Partial<FinalizeArgs> = {}): FinalizeArgs {
    return {
        tournamentId: 7n,
        point: 100n,
        deadline: futureDeadline(sim),
        bracket: bracketFor(3n),
        segment: pad32("20s:F"),
        ...over,
    };
}

/** Backend flow: derive the user's leaf for (tournament, point, deadline) and insert it as `signer`. */
async function grantFor(f: Fixture, user: User, a: FinalizeArgs, by: Wallet = f.signer): Promise<Uint8Array> {
    const pk = f.tournamentFinalizer.userPublicKey(user.ps.userSecret);
    const leaf = f.tournamentFinalizer.eligibilityLeaf(pk, a.tournamentId, a.point, a.deadline, a.bracket);
    await f.tournamentFinalizer.as(by).grantEligibility(leaf);
    return leaf;
}

async function finalizeAs(f: Fixture, user: User, a: FinalizeArgs): Promise<void> {
    await f.tournamentFinalizer.as(user.wallet).withPrivateState(user.ps).finalizeTournament(a);
}

describe("TournamentFinalizer", function () {
    let f: Fixture;
    beforeEach(async () => {
        f = await deployTournamentFinalizerFixture();
    });

    describe("constructor", function () {
        it("stores the deployer as owner, the signer, and the domain tag", async function () {
            const l = f.tournamentFinalizer.getLedger();
            expect(l.owner).toEqual(f.owner.bytes);
            expect(l.finalizeSigner).toEqual(f.signer.bytes);
            expect(l.domainTag).toEqual(DOMAIN_TAG);
            expect(l.finalizedCount).toEqual(0n);
        });

        it("reverts on the zero signer (ZeroAddress)", async function () {
            await expect(TournamentFinalizerSimulator.deploy(f.owner, ZERO_BYTES32, DOMAIN_TAG)).rejects.toThrow("ZeroAddress");
        });
    });

    describe("grantEligibility", function () {
        it("lets the signer insert an eligibility leaf", async function () {
            const a = baseArgs(f.tournamentFinalizer);
            const leaf = await grantFor(f, f.caller, a);
            expect(f.tournamentFinalizer.getLedger().eligibility.findPathForLeaf(leaf)).toBeDefined();
            expect(f.tournamentFinalizer.getLedger().grantedCount).toEqual(1n);
        });

        it("reverts with NotSigner for anyone else (owner included)", async function () {
            const a = baseArgs(f.tournamentFinalizer);
            await expect(grantFor(f, f.caller, a, f.other)).rejects.toThrow("NotSigner");
            await expect(grantFor(f, f.caller, a, f.owner)).rejects.toThrow("NotSigner");
        });

        // BE 는 grant 를 비동기 제출하고, tx 가 죽은 것으로 판정되면 **같은 leaf** 를 다시 넣는다. 인덱서 지연으로 살아 있는
        // tx 를 죽은 것으로 오판하면 트리에 같은 leaf 가 두 번 들어간다 — 그래도 membership/finalize 는 그대로고
        // 표시용 카운터만 한 번 더 오른다는 것을 고정한다 (재발급이 안전하다는 전제의 근거).
        it("tolerates the same leaf granted twice — membership and finalize unchanged, grantedCount double-counts", async function () {
            const a = baseArgs(f.tournamentFinalizer);
            const first = await grantFor(f, f.caller, a);
            const second = await grantFor(f, f.caller, a);
            expect(second).toEqual(first);
            const l = f.tournamentFinalizer.getLedger();
            expect(l.eligibility.findPathForLeaf(first)).toBeDefined();
            expect(l.grantedCount).toEqual(2n);
            await finalizeAs(f, f.caller, a);
            expect(f.tournamentFinalizer.getLedger().finalizedCount).toEqual(1n);
            // 이미 finalize 한 뒤 같은 leaf 로 다시는 안 된다 — 중복 leaf 가 nullifier 를 우회하지 않는다
            await expect(finalizeAs(f, f.caller, a)).rejects.toThrow("AlreadyFinalized");
        });
    });

    describe("finalizeTournament (happy path)", function () {
        it("verifies a valid eligibility, records the vote commitment, and consumes the nullifier", async function () {
            const a = baseArgs(f.tournamentFinalizer);
            await grantFor(f, f.caller, a);
            await finalizeAs(f, f.caller, a);

            const l = f.tournamentFinalizer.getLedger();
            expect(l.finalizedCount).toEqual(1n);
            expect(l.sampleCount.lookup(a.tournamentId).read()).toEqual(1n);
            expect(l.nullifiers.member(f.tournamentFinalizer.voteNullifier(f.caller.ps.userSecret, a.tournamentId))).toBe(true);
            expect(l.voteCommits.firstFree()).toEqual(1n);
        });

        it("seals the full bracket inside the commitment — no per-pick ledger state exists (B-design)", async function () {
            const a = baseArgs(f.tournamentFinalizer, { bracket: [3n, 10n, 11n, 12n, 13n, 14n, 15n, 16n, 17n, 18n, 19n, 20n, 21n, 22n, 23n, 24n] });
            await grantFor(f, f.caller, a);
            await finalizeAs(f, f.caller, a);
            const l = f.tournamentFinalizer.getLedger() as Record<string, unknown>;
            // 공개 집계 ledger 가 아예 없어야 한다 — 선택은 판매 전까지 비공개
            expect(l.tally).toBeUndefined();
            expect(l.matchLowWins).toBeUndefined();
            expect(l.matchHighWins).toBeUndefined();
            // 대신 브라켓 전체가 bracketHash 로 커밋 안에 봉인된다 — 정확한 로우로만 열린다
            const row = { tournamentId: a.tournamentId, itemId: a.bracket[0], bracketHash: f.tournamentFinalizer.bracketHash(a.bracket), segment: a.segment };
            const commit = f.tournamentFinalizer.voteCommitment(row, f.caller.ps.voteSalt);
            expect((f.tournamentFinalizer.getLedger()).voteCommits.findPathForLeaf(commit)).toBeDefined();
            // 브라켓이 다르면 커밋이 열리지 않는다
            const wrong = { ...row, bracketHash: f.tournamentFinalizer.bracketHash([...a.bracket.slice(0, 15), 99n]) };
            expect((f.tournamentFinalizer.getLedger()).voteCommits.findPathForLeaf(f.tournamentFinalizer.voteCommitment(wrong, f.caller.ps.voteSalt))).toBeUndefined();
        });

        for (const size of [32, 64]) {
            it(`finalizes a ${size}-round bracket via finalizeTournament${size}`, async function () {
                const a = baseArgs(f.tournamentFinalizer, { bracket: bracketFor(3n, size) });
                await grantFor(f, f.caller, a);
                await finalizeAs(f, f.caller, a);
                const l = f.tournamentFinalizer.getLedger();
                expect(l.sampleCount.lookup(a.tournamentId).read()).toEqual(1n);
                const row = { tournamentId: a.tournamentId, itemId: 3n, bracketHash: f.tournamentFinalizer.bracketHash(a.bracket), segment: a.segment };
                expect(l.voteCommits.findPathForLeaf(f.tournamentFinalizer.voteCommitment(row, f.caller.ps.voteSalt))).toBeDefined();
            });
        }

        it("rejects a bracket different from the granted one (bracketHash bound into the leaf)", async function () {
            const a = baseArgs(f.tournamentFinalizer);
            await grantFor(f, f.caller, a);
            const tampered = { ...a, bracket: [...a.bracket.slice(0, 15), 99n] };
            await expect(finalizeAs(f, f.caller, tampered)).rejects.toThrow("InvalidSigner");
        });

        it("accepts any granted bracket verbatim — validity is enforced at grant time (B-design)", async function () {
            // B-design 에서는 회로가 브라켓 내용을 검사하지 않는다: 매치 카운터가 없어 오염될 공개
            // 상태가 없고, 유효성(중복 등)은 grant 시 BE 가 검증하며 leaf 의 bracketHash 바인딩이
            // "grant 된 그 브라켓"만 제출되게 강제한다.
            const a = baseArgs(f.tournamentFinalizer, { bracket: bracketFor(3n).with(1, 3n) });
            await grantFor(f, f.caller, a);
            await finalizeAs(f, f.caller, a);
            expect(f.tournamentFinalizer.getLedger().finalizedCount).toEqual(1n);
        });

        it("does not disclose the chosen item or segment on the ledger", async function () {
            const a = baseArgs(f.tournamentFinalizer);
            await grantFor(f, f.caller, a);
            await finalizeAs(f, f.caller, a);
            // The only per-vote artifacts are an opaque commitment + nullifier. No key ever equals the raw itemId.
            const l = f.tournamentFinalizer.getLedger();
            for (const c of l.nullifiers) expect(c).not.toEqual(a.segment);
            expect(l.voteCommits.findPathForLeaf(a.segment)).toBeUndefined();
        });

        it("derives the user public key deterministically (cross-check with pureCircuits)", async function () {
            const pk1 = f.tournamentFinalizer.userPublicKey(f.caller.ps.userSecret);
            const pk2 = f.tournamentFinalizer.userPublicKey(f.caller.ps.userSecret);
            expect(pk1).toEqual(pk2);
            expect(pk1).not.toEqual(f.tournamentFinalizer.userPublicKey(randomBytes(32)));
        });

        it("allows distinct users to finalize with their own nullifiers", async function () {
            const a = baseArgs(f.tournamentFinalizer);
            const a2 = { ...a, bracket: bracketFor(5n) };
            const u2 = makeUser();
            await grantFor(f, f.caller, a);
            await grantFor(f, u2, a2);
            await finalizeAs(f, f.caller, a);
            await finalizeAs(f, u2, a2);
            const l = f.tournamentFinalizer.getLedger();
            expect(l.finalizedCount).toEqual(2n);
            expect(l.sampleCount.lookup(a.tournamentId).read()).toEqual(2n);
        });

        it("lets the same user finalize different tournaments", async function () {
            const a1 = baseArgs(f.tournamentFinalizer, { tournamentId: 1n });
            const a2 = baseArgs(f.tournamentFinalizer, { tournamentId: 2n });
            await grantFor(f, f.caller, a1);
            await grantFor(f, f.caller, a2);
            await finalizeAs(f, f.caller, a1);
            await finalizeAs(f, f.caller, a2);
            expect(f.tournamentFinalizer.getLedger().finalizedCount).toEqual(2n);
        });
    });

    describe("finalizeTournament (rejections)", function () {
        it("reverts with ExpiredSignature when the deadline has passed", async function () {
            const a = baseArgs(f.tournamentFinalizer, { deadline: BigInt(f.tournamentFinalizer.now() - 1) });
            await grantFor(f, f.caller, a);
            await expect(finalizeAs(f, f.caller, a)).rejects.toThrow("ExpiredSignature");
        });

        it("reverts with InvalidSigner when eligibility was never granted", async function () {
            const a = baseArgs(f.tournamentFinalizer);
            await expect(finalizeAs(f, f.caller, a)).rejects.toThrow("InvalidSigner");
        });

        it("reverts with InvalidSigner when the caller differs from the eligible user", async function () {
            const a = baseArgs(f.tournamentFinalizer);
            await grantFor(f, f.caller, a);
            const impostor = makeUser();
            await expect(finalizeAs(f, impostor, a)).rejects.toThrow("InvalidSigner");
        });

        it("reverts with InvalidSigner when the point is tampered after granting", async function () {
            const a = baseArgs(f.tournamentFinalizer);
            await grantFor(f, f.caller, a);
            await expect(finalizeAs(f, f.caller, { ...a, point: a.point + 1n })).rejects.toThrow("InvalidSigner");
        });

        it("reverts with InvalidSigner when the tournamentId is tampered after granting", async function () {
            const a = baseArgs(f.tournamentFinalizer);
            await grantFor(f, f.caller, a);
            await expect(finalizeAs(f, f.caller, { ...a, tournamentId: a.tournamentId + 1n })).rejects.toThrow("InvalidSigner");
        });

        it("reverts with InvalidSigner when the deadline is tampered after granting", async function () {
            const a = baseArgs(f.tournamentFinalizer);
            await grantFor(f, f.caller, a);
            await expect(finalizeAs(f, f.caller, { ...a, deadline: a.deadline + 1n })).rejects.toThrow("InvalidSigner");
        });

        it("prevents replay: finalizing the same tournament twice reverts (nullifier already consumed)", async function () {
            const a = baseArgs(f.tournamentFinalizer);
            await grantFor(f, f.caller, a);
            await finalizeAs(f, f.caller, a);
            // even with a second grant (different bracket), the nullifier blocks a second vote
            const a2 = { ...a, bracket: bracketFor(9n) };
            await grantFor(f, f.caller, a2);
            await expect(finalizeAs(f, f.caller, a2)).rejects.toThrow("AlreadyFinalized");
        });

        it("reverts on a malformed eligibility path", async function () {
            const a = baseArgs(f.tournamentFinalizer);
            const leaf = await grantFor(f, f.caller, a);
            const bogus = { ...f.caller, ps: { ...f.caller.ps, forcedEligibilityPath: { leaf, path: Array.from({ length: 16 }, () => ({ sibling: { field: 1n }, goes_left: true })) } } };
            await expect(finalizeAs(f, bogus, a)).rejects.toThrow("InvalidSigner");
        });

    });

    describe("finalizeTournament (no on-chain data validation)", function () {
        it("processes tournamentId 0 normally", async function () {
            const a = baseArgs(f.tournamentFinalizer, { tournamentId: 0n });
            await grantFor(f, f.caller, a);
            await finalizeAs(f, f.caller, a);
            expect(f.tournamentFinalizer.getLedger().sampleCount.lookup(0n).read()).toEqual(1n);
        });

        it("processes itemId 0 champion and point 0 normally", async function () {
            const a = baseArgs(f.tournamentFinalizer, { bracket: bracketFor(0n), point: 0n });
            await grantFor(f, f.caller, a);
            await finalizeAs(f, f.caller, a);
            expect(f.tournamentFinalizer.getLedger().sampleCount.lookup(a.tournamentId).read()).toEqual(1n);
        });

        it("accepts an all-zero segment", async function () {
            const u = makeUser();
            const a = baseArgs(f.tournamentFinalizer, { segment: ZERO_BYTES32 });
            await grantFor(f, u, a);
            await finalizeAs(f, u, a);
            expect(f.tournamentFinalizer.getLedger().finalizedCount).toEqual(1n);
        });
    });

    describe("setFinalizeSigner", function () {
        it("lets the owner update the signer", async function () {
            await f.tournamentFinalizer.as(f.owner).setFinalizeSigner(f.other.bytes);
            expect(f.tournamentFinalizer.getLedger().finalizeSigner).toEqual(f.other.bytes);
        });

        it("makes grants from the new signer pass and the old signer fail", async function () {
            await f.tournamentFinalizer.as(f.owner).setFinalizeSigner(f.other.bytes);
            const a = baseArgs(f.tournamentFinalizer);
            await expect(grantFor(f, f.caller, a, f.signer)).rejects.toThrow("NotSigner");
            await grantFor(f, f.caller, a, f.other);
            await finalizeAs(f, f.caller, a);
            expect(f.tournamentFinalizer.getLedger().finalizedCount).toEqual(1n);
        });

        it("reverts for a non-owner", async function () {
            await expect(f.tournamentFinalizer.as(f.other).setFinalizeSigner(f.other.bytes)).rejects.toThrow("NotOwner");
        });

        it("reverts on the zero address", async function () {
            await expect(f.tournamentFinalizer.as(f.owner).setFinalizeSigner(ZERO_BYTES32)).rejects.toThrow("ZeroAddress");
        });

        it("reverts when set to the current signer (ValueUnchanged)", async function () {
            await expect(f.tournamentFinalizer.as(f.owner).setFinalizeSigner(f.signer.bytes)).rejects.toThrow("ValueUnchanged");
        });
    });

    describe("setDomainTag", function () {
        it("lets the owner update the domain tag", async function () {
            const next = pad32("pnyx:finalize:v2");
            await f.tournamentFinalizer.as(f.owner).setDomainTag(next);
            expect(f.tournamentFinalizer.getLedger().domainTag).toEqual(next);
        });

        it("makes a grant issued under the old tag invalid after the tag changes", async function () {
            const a = baseArgs(f.tournamentFinalizer);
            await grantFor(f, f.caller, a);
            await f.tournamentFinalizer.as(f.owner).setDomainTag(pad32("pnyx:finalize:v2"));
            await expect(finalizeAs(f, f.caller, a)).rejects.toThrow("InvalidSigner");
        });

        it("reverts for a non-owner", async function () {
            await expect(f.tournamentFinalizer.as(f.other).setDomainTag(pad32("x"))).rejects.toThrow("NotOwner");
        });

        it("reverts when the domain tag is unchanged (ValueUnchanged)", async function () {
            await expect(f.tournamentFinalizer.as(f.owner).setDomainTag(DOMAIN_TAG)).rejects.toThrow("ValueUnchanged");
        });
    });
});
