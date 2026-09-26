import { positional } from "../lib/config.js";
import { closeSession, logTx, tournamentFinalizerSession } from "../lib/session.js";
import { bytes32 } from "../lib/bytes.js";
import { TF } from "../lib/contracts.js";

/*
 * Operator (finalizeSigner wallet) grants a user eligibility. Replaces the backend's EIP-712
 * signature: PNYX-BE computes the leaf and inserts it on-chain.
 *
 *   USER_PK=<64hex> npx tsx scripts/tournamentFinalizer/grantEligibility.ts --network preprod <tournamentId> <point> <deadlineUnix> <b0..b7 8개>
 */
const [tournamentId, point, deadline, ...bracketArgs] = positional();
if (!tournamentId || !point || !deadline || ![16, 32, 64].includes(bracketArgs.length)) {
    throw new Error("usage: grantEligibility.ts --network <n> <tournamentId> <point> <deadlineUnix> <bracket 16|32|64 ids>");
}
const userPk = bytes32(process.env.USER_PK ?? "", "USER_PK");
const bracket = bracketArgs.map((x) => BigInt(x));

const s = await tournamentFinalizerSession();
try {
    const ledger = TF.ledger((await s.providers.publicDataProvider.queryContractState(s.address))!.data);
    const hashers: Record<number, (b: bigint[]) => Uint8Array> = { 16: TF.pureCircuits.bracketHash16, 32: TF.pureCircuits.bracketHash32, 64: TF.pureCircuits.bracketHash64 };
    const bHash = hashers[bracket.length](bracket);
    const leaf = TF.pureCircuits.eligibilityLeaf(ledger.domainTag, userPk, BigInt(tournamentId), BigInt(point), BigInt(deadline), bHash);
    logTx("grantEligibility", await s.contract.callTx.grantEligibility(leaf));
} finally {
    await closeSession(s);
}
