import fs from "node:fs";
import { positional } from "../lib/config.js";
import { closeSession, logTx, tournamentFinalizerSession, userPrivateState } from "../lib/session.js";
import { bytes32, pad32, sha256 } from "../lib/bytes.js";
import { loadEscrow } from "./escrow.js";

/*
 * The single data product — operator proves the escrowed rows are on-chain and pins the hash of
 * the (already buyer-encrypted) dataset file. License records rowCount + sampleAtSale.
 *   npx tsx scripts/dataMarket/sellRows.ts --network preprod <buyerPk> <tournamentId> <specTag> <encryptedDatasetPath>
 */
const [buyerPk, tournamentId, spec, datasetPath] = positional();
if (!buyerPk || !tournamentId || !spec || !datasetPath) {
    throw new Error("usage: sellRows.ts --network <n> <buyerPk> <tournamentId> <specTag> <encryptedDatasetPath>");
}
const datasetHash = sha256(new Uint8Array(fs.readFileSync(datasetPath)));

const s = await tournamentFinalizerSession({ ...userPrivateState(), escrow: loadEscrow(Number(tournamentId)) });
try {
    logTx("sellRows", await s.contract.callTx.sellRows(bytes32(buyerPk, "buyerPk"), BigInt(tournamentId), pad32(spec), datasetHash));
} finally {
    await closeSession(s);
}
