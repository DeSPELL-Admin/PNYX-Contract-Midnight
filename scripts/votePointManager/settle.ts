import { positional } from "../lib/config.js";
import { closeSession, logTx, votePointManagerSession } from "../lib/session.js";
import { optionTag } from "../lib/bytes.js";

/*
 * User settles a granted intent. Mirrors settle.ts in the Solidity repo. Private input: USER_SECRET.
 *   npx tsx scripts/votePointManager/settle.ts --network preprod <tournamentId> <itemId> <amount> <option> <deadlineUnix> <nonce>
 */
const [tournamentId, itemId, amount, option, deadline, nonce] = positional();
if (!tournamentId || !itemId || !amount || option === undefined || !deadline || !nonce) {
    throw new Error("usage: settle.ts --network <n> <tournamentId> <itemId> <amount> <option> <deadlineUnix> <nonce>");
}

const s = await votePointManagerSession();
try {
    logTx("settle", await s.contract.callTx.settle(BigInt(tournamentId), BigInt(itemId), BigInt(amount), optionTag(option), BigInt(deadline), BigInt(nonce)));
} finally {
    await closeSession(s);
}
