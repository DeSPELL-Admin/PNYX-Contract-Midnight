import { positional } from "../lib/config.js";
import { closeSession, tournamentFinalizerSession } from "../lib/session.js";
import { bytes32, pad32, toHex } from "../lib/bytes.js";
import { TF } from "../lib/contracts.js";

/* Read one License from the ledger — what the buyer checks after purchase.
 *   npx tsx scripts/dataMarket/showLicense.ts --network preprod <buyerPk> <tournamentId> <specTag> */
const [buyerPk, tournamentId, spec] = positional();
if (!buyerPk || !tournamentId || !spec) throw new Error("usage: showLicense.ts --network <n> <buyerPk> <tournamentId> <specTag>");

const s = await tournamentFinalizerSession();
try {
    const ledger = TF.ledger((await s.providers.publicDataProvider.queryContractState(s.address))!.data);
    const id = TF.pureCircuits.licenseId(bytes32(buyerPk, "buyerPk"), BigInt(tournamentId), pad32(spec));
    if (!ledger.licenses.member(id)) { console.log("license: NOT FOUND"); process.exit(1); }
    const lic = ledger.licenses.lookup(id);
    console.log(`license ${toHex(id).slice(0, 16)}…`);
    console.log(`  tournamentId : ${lic.tournamentId}`);
    console.log(`  rowCount     : ${lic.rowCount}`);
    console.log(`  sampleAtSale : ${lic.sampleAtSale}  ${lic.rowCount === lic.sampleAtSale ? "→ FULL dataset as of sale ✓" : "→ PARTIAL dataset ✗"}`);
    console.log(`  datasetHash  : ${toHex(lic.datasetHash)}`);
    console.log(`  commitDigest : ${toHex(lic.commitDigest).slice(0, 20)}…`);
} finally {
    await closeSession(s);
}
