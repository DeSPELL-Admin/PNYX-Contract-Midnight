import { positional } from "../lib/config.js";
import { closeSession, logTx, votePointManagerSession } from "../lib/session.js";
import { bytes32, optionTag } from "../lib/bytes.js";
import { VPM } from "../lib/contracts.js";

/*
 * Operator grants a settle intent for a user (replaces the backend Vote signature).
 *   USER_PK=<64hex> npx tsx scripts/votePointManager/grantSettle.ts --network preprod <tournamentId> <itemId> <amount> <option> <deadlineUnix> <nonce>
 */
const [tournamentId, itemId, amount, option, deadline, nonce] = positional();
if (!tournamentId || !itemId || !amount || option === undefined || !deadline || !nonce) {
    throw new Error("usage: grantSettle.ts --network <n> <tournamentId> <itemId> <amount> <option> <deadlineUnix> <nonce>");
}
const userPk = bytes32(process.env.USER_PK ?? "", "USER_PK");

const s = await votePointManagerSession();
try {
    const ledger = VPM.ledger((await s.providers.publicDataProvider.queryContractState(s.address))!.data);
    const leaf = VPM.pureCircuits.settleLeaf(ledger.domainTag, userPk, BigInt(tournamentId), BigInt(itemId), BigInt(amount), optionTag(option), BigInt(deadline), BigInt(nonce));
    logTx("grantSettle", await s.contract.callTx.grantSettle(leaf));
} finally {
    await closeSession(s);
}
