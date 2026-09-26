import { requireEnv } from "./lib/config.js";
import { pureCircuits } from "../contracts/managed/TournamentFinalizer/contract/index.js";
import { bytes32, toHex } from "./lib/bytes.js";
/* Print the user public key for USER_SECRET (what the operator needs to grant eligibility). */
console.log(toHex(pureCircuits.userPublicKey(bytes32(requireEnv("USER_SECRET"), "USER_SECRET"))));
