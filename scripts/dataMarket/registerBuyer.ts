import { positional } from "../lib/config.js";
import { closeSession, logTx, tournamentFinalizerSession } from "../lib/session.js";
import { bytes32 } from "../lib/bytes.js";

/* Operator registers a buyer's delivery public key.  npx tsx scripts/dataMarket/registerBuyer.ts --network preprod <buyerPk 64hex> */
const [buyerPk] = positional();
if (!buyerPk) throw new Error("usage: registerBuyer.ts --network <n> <buyerPk>");

const s = await tournamentFinalizerSession();
try {
    logTx("registerBuyer", await s.contract.callTx.registerBuyer(bytes32(buyerPk, "buyerPk")));
} finally {
    await closeSession(s);
}
