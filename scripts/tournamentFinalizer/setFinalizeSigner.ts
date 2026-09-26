import { closeSession, logTx, tournamentFinalizerSession } from "../lib/session.js";
import { bytes32 } from "../lib/bytes.js";

/* Owner rotates the operator key.  NEW_SIGNER=<64hex> npx tsx scripts/tournamentFinalizer/setFinalizeSigner.ts --network preprod */
const s = await tournamentFinalizerSession();
try {
    logTx("setFinalizeSigner", await s.contract.callTx.setFinalizeSigner(bytes32(process.env.NEW_SIGNER ?? "", "NEW_SIGNER")));
} finally {
    await closeSession(s);
}
