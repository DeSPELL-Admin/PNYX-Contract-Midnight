import { describe, it, expect, beforeEach } from "vitest";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import {
    ESCROW_BATCH,
    TournamentFinalizerSimulator,
    type EscrowEntry,
    type FinalizeArgs,
    type TournamentFinalizerPrivateState,
} from "./simulators/TournamentFinalizer.sim.js";
import { makeWallet, pad32, randomBytes, type Wallet } from "./helpers/bytes.js";

setNetworkId("undeployed");

// B2B data-market flow on top of TournamentFinalizer (see midnight/SPEC.md §4–5):
//   registerBuyer → sellRows (the single product: the tournament's full row dataset as of now).
// sellRows is run by the operator (finalizeSigner) with the escrowed rows as witness, proves each
// row opens a commitment in `voteCommits`, and records rowCount + sampleAtSale so the buyer can
// verify on-chain that they received the complete dataset (rowCount == sampleAtSale).

const DOMAIN_TAG = pad32("pnyx:finalize:v1");
const SEG_20F = pad32("20s:F");
const SPEC_HASH = pad32("spec:v1");
const DATASET_HASH = pad32("dataset:enc");
const TID = 7n;

type User = { wallet: Wallet; ps: TournamentFinalizerPrivateState };
function makeUser(): User {
    return { wallet: makeWallet(), ps: { userSecret: randomBytes(32), voteSalt: randomBytes(32) } };
}

async function deployFixture() {
    const owner = makeWallet();
    const signer = makeWallet(); // operator: grants eligibility, registers buyers, runs sell proofs
    const other = makeWallet();
    const buyer = makeWallet(); // buyer's x25519-ish delivery key, represented as 32 bytes
    const sim = await TournamentFinalizerSimulator.deploy(owner, signer.bytes, DOMAIN_TAG);
    const escrow: EscrowEntry[] = [];
    return { sim, owner, signer, other, buyer, escrow };
}
type Fixture = Awaited<ReturnType<typeof deployFixture>>;

function bracketFor(champion: bigint, size = 16): bigint[] {
    const others: bigint[] = [];
    for (let i = 10n; others.length < size - 1; i++) if (i !== champion) others.push(i);
    return [champion, ...others];
}

/** Full user flow: grant → finalize → escrow the row + salt like PNYX-BE does (every vote). */
async function vote(f: Fixture, over: Partial<FinalizeArgs & { itemId: bigint }> = {}, escrowOverride?: Partial<EscrowEntry["row"]>): Promise<User> {
    const u = makeUser();
    const { itemId, ...rest } = over;
    const a: FinalizeArgs = {
        tournamentId: TID,
        point: 10n,
        deadline: BigInt(f.sim.now() + 3600),
        bracket: bracketFor(itemId ?? 3n),
        segment: SEG_20F,
        ...rest,
    };
    const pk = f.sim.userPublicKey(u.ps.userSecret);
    await f.sim.as(f.signer).grantEligibility(f.sim.eligibilityLeaf(pk, a.tournamentId, a.point, a.deadline, a.bracket));
    await f.sim.as(u.wallet).withPrivateState(u.ps).finalizeTournament(a);
    f.escrow.push({ row: { tournamentId: a.tournamentId, itemId: a.bracket[0], bracketHash: f.sim.bracketHash(a.bracket), segment: a.segment, ...escrowOverride }, salt: u.ps.voteSalt });
    return u;
}

function operator(f: Fixture) {
    return f.sim.as(f.signer).withPrivateState({ userSecret: new Uint8Array(32), voteSalt: new Uint8Array(32), escrow: f.escrow });
}

describe("DataMarket (TournamentFinalizer)", function () {
    let f: Fixture;
    beforeEach(async () => {
        f = await deployFixture();
    });

    describe("registerBuyer", function () {
        it("lets the signer register a buyer", async function () {
            await f.sim.as(f.signer).registerBuyer(f.buyer.bytes);
            expect(f.sim.getLedger().buyers.member(f.buyer.bytes)).toBe(true);
        });

        it("reverts with NotSigner for anyone else", async function () {
            await expect(f.sim.as(f.other).registerBuyer(f.buyer.bytes)).rejects.toThrow("NotSigner");
        });

        it("reverts on the zero key", async function () {
            await expect(f.sim.as(f.signer).registerBuyer(new Uint8Array(32))).rejects.toThrow("ZeroAddress");
        });
    });

    describe("sellRows (the single product)", function () {
        beforeEach(async () => {
            await f.sim.as(f.signer).registerBuyer(f.buyer.bytes);
        });

        it("records a license with dataset hash, row count, commitment digest and sampleAtSale", async function () {
            await vote(f, { itemId: 3n });
            await vote(f, { itemId: 5n });
            await operator(f).sellRows(f.buyer.bytes, TID, SPEC_HASH, DATASET_HASH);

            const lic = f.sim.getLedger().licenses.lookup(f.sim.licenseId(f.buyer.bytes, TID, SPEC_HASH));
            expect(lic.rowCount).toEqual(2n);
            expect(lic.sampleAtSale).toEqual(2n); // rowCount == sampleAtSale ⇒ 구매자가 "현재시점 전체"임을 체인에서 검증
            expect(lic.datasetHash).toEqual(DATASET_HASH);
            expect(lic.commitDigest).not.toEqual(new Uint8Array(32));
        });

        it("records sampleAtSale from the on-chain counter even when escrow is partial", async function () {
            await vote(f, { itemId: 3n });
            await vote(f, { itemId: 5n });
            f.escrow.pop(); // operator escrow lost one row → delivered 1 of 2
            await operator(f).sellRows(f.buyer.bytes, TID, SPEC_HASH, DATASET_HASH);
            const lic = f.sim.getLedger().licenses.lookup(f.sim.licenseId(f.buyer.bytes, TID, SPEC_HASH));
            expect(lic.rowCount).toEqual(1n);
            expect(lic.sampleAtSale).toEqual(2n); // 구매자는 불완전 데이터셋임을 알 수 있다
        });

        it("reverts with RowNotOnChain when an escrowed row was tampered", async function () {
            await vote(f);
            await vote(f, { itemId: 3n }, { itemId: 9n });
            await expect(operator(f).sellRows(f.buyer.bytes, TID, SPEC_HASH, DATASET_HASH)).rejects.toThrow("RowNotOnChain");
        });

        it("reverts with WrongTournament when escrow contains a row from another tournament", async function () {
            await vote(f);
            await vote(f, {}, { tournamentId: TID + 1n });
            await expect(operator(f).sellRows(f.buyer.bytes, TID, SPEC_HASH, DATASET_HASH)).rejects.toThrow("WrongTournament");
        });

        it("reverts with EmptyDataset when no rows are escrowed for the tournament", async function () {
            await expect(operator(f).sellRows(f.buyer.bytes, TID, SPEC_HASH, DATASET_HASH)).rejects.toThrow("EmptyDataset");
        });

        it("reverts with BuyerNotRegistered for an unknown buyer", async function () {
            await vote(f);
            await expect(operator(f).sellRows(f.other.bytes, TID, SPEC_HASH, DATASET_HASH)).rejects.toThrow("BuyerNotRegistered");
        });

        it("reverts with NotSigner when run by anyone but the operator", async function () {
            await vote(f);
            const rogue = f.sim.as(f.other).withPrivateState({ userSecret: new Uint8Array(32), voteSalt: new Uint8Array(32), escrow: f.escrow });
            await expect(rogue.sellRows(f.buyer.bytes, TID, SPEC_HASH, DATASET_HASH)).rejects.toThrow("NotSigner");
        });

        it("reverts with LicenseExists on a duplicate (buyer, tournament, spec)", async function () {
            await vote(f);
            await operator(f).sellRows(f.buyer.bytes, TID, SPEC_HASH, DATASET_HASH);
            await expect(operator(f).sellRows(f.buyer.bytes, TID, SPEC_HASH, DATASET_HASH)).rejects.toThrow("LicenseExists");
        });

        it("only proves up to one batch of rows per license", async function () {
            for (let i = 0; i < ESCROW_BATCH + 2; i++) await vote(f, { itemId: BigInt(i) });
            await operator(f).sellRows(f.buyer.bytes, TID, SPEC_HASH, DATASET_HASH);
            const lic = f.sim.getLedger().licenses.lookup(f.sim.licenseId(f.buyer.bytes, TID, SPEC_HASH));
            expect(lic.rowCount).toEqual(BigInt(ESCROW_BATCH));
            expect(lic.sampleAtSale).toEqual(BigInt(ESCROW_BATCH + 2));
        });
    });
});
