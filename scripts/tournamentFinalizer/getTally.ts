import { positional } from "../lib/config.js";
import { closeSession, tournamentFinalizerSession } from "../lib/session.js";
import { readTournamentFinalizerLedger } from "../lib/contracts.js";

/*
 * Read the public state for a tournament. B-design: picks are sealed inside commitments —
 * the ONLY public aggregate is the participation count. No tally, no match counters.
 *   npx tsx scripts/tournamentFinalizer/getTally.ts --network preprod <tournamentId>
 */
const [tournamentId] = positional();
if (!tournamentId) throw new Error("usage: getTally.ts --network <n> <tournamentId>");

const s = await tournamentFinalizerSession();
try {
    const l = await readTournamentFinalizerLedger(s.providers, s.address);
    const tid = BigInt(tournamentId);
    const sample = l.sampleCount.member(tid) ? l.sampleCount.lookup(tid).read() : 0n;
    console.log(`tournament ${tid}: sample=${sample} finalized=${l.finalizedCount} granted=${l.grantedCount} licenses=${l.licenseCount}`);
    console.log("  (B-design: per-item tallies and match counters do not exist on-chain — picks are sealed until sold)");
} finally {
    await closeSession(s);
}
