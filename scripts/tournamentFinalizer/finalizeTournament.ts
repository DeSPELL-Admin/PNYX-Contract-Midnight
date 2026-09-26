import { positional } from "../lib/config.js";
import { closeSession, logTx, tournamentFinalizerSession } from "../lib/session.js";
import { pad32 } from "../lib/bytes.js";

/*
 * User finalizes a tournament (the ZK vote). Mirrors finalizeTournament.ts in the Solidity repo.
 * Private inputs come from env: USER_SECRET, VOTE_SALT (both 64 hex).
 *
 *   npx tsx scripts/tournamentFinalizer/finalizeTournament.ts --network preprod <tournamentId> <point> <deadlineUnix> <segment> <bracket 16|32|64 ids>
 */
const [tournamentId, point, deadline, segment = "", ...bracketArgs] = positional();
if (!tournamentId || !point || !deadline || ![16, 32, 64].includes(bracketArgs.length)) {
    throw new Error("usage: finalizeTournament.ts --network <n> <tournamentId> <point> <deadlineUnix> <segment> <bracket 16|32|64 ids>");
}
const bracket = bracketArgs.map((x) => BigInt(x));

const s = await tournamentFinalizerSession();
try {
    const t0 = Date.now();
    const name = `finalizeTournament${bracket.length}` as "finalizeTournament16" | "finalizeTournament32" | "finalizeTournament64";
    const tx = await s.contract.callTx[name](BigInt(tournamentId), BigInt(point), BigInt(deadline), bracket, pad32(segment));
    logTx("finalizeTournament", tx);
    console.log(`elapsed(prove+balance+submit): ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} finally {
    await closeSession(s);
}
