import fs from "node:fs";
import path from "node:path";
import { scriptsDir } from "../lib/config.js";
import { fromHex, pad32 } from "../lib/bytes.js";
import type { EscrowEntry } from "../../contracts/witnesses/TournamentFinalizer.witnesses.js";
import { TF } from "../lib/contracts.js";

/*
 * Operator-side escrow store used by the sell scripts. In production this is PNYX-BE's database;
 * here it is a JSON file so the hackathon flow can be driven from the CLI.
 *
 *   scripts/output/escrow.json
 *   [{ "tournamentId": 7, "itemId": 3, "bracket": [3,10,…16개], "segment": "20s:F", "salt": "<64hex>" }, …]
 */
export const escrowFile = path.resolve(scriptsDir, "output", "escrow.json");

type EscrowJson = { tournamentId: number; itemId: number; bracket: number[]; segment: string; salt: string };

/** witness 에 필터가 없으므로 판매할 토너먼트의 로우만 실어 보낸다 (아니면 회로가 WrongTournament). */
export function loadEscrow(tournamentId?: number): EscrowEntry[] {
    if (!fs.existsSync(escrowFile)) return [];
    const raw = JSON.parse(fs.readFileSync(escrowFile, "utf8")) as EscrowJson[];
    return raw
        .filter((r) => tournamentId === undefined || r.tournamentId === tournamentId)
        .map((r) => {
            const hashers: Record<number, (b: bigint[]) => Uint8Array> = { 16: TF.pureCircuits.bracketHash16, 32: TF.pureCircuits.bracketHash32, 64: TF.pureCircuits.bracketHash64 };
            const hasher = hashers[r.bracket?.length ?? 0];
            if (!hasher) throw new Error(`escrow row needs bracket of 16/32/64 ids (got ${r.bracket?.length ?? 0})`);
            return {
                row: { tournamentId: BigInt(r.tournamentId), itemId: BigInt(r.itemId), bracketHash: hasher(r.bracket.map((x) => BigInt(x))), segment: pad32(r.segment) },
                salt: fromHex(r.salt),
            };
        });
}
