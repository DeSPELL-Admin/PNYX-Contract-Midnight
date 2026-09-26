import fs from "node:fs";
import path from "node:path";
import { scriptsDir, type NetworkName } from "./config.js";

/*
 * scripts/output/<network>-deployment-info.json — same role as in the Solidity repo:
 * deploy scripts write the address, interaction scripts read it back (and throw if missing).
 */

export type ContractKey = "tournamentFinalizer" | "votePointManager";

export interface DeploymentInfo {
    network: NetworkName;
    deployedAt: string;
    contracts: Partial<Record<ContractKey, string>>;
    finalizeSigner?: string;
    voteSigner?: string;
    domainTags?: Partial<Record<ContractKey, string>>;
}

export const outputDir = path.resolve(scriptsDir, "output");

function fileFor(network: NetworkName): string {
    return path.resolve(outputDir, `${network}-deployment-info.json`);
}

export function readDeploymentInfo(network: NetworkName): DeploymentInfo {
    const f = fileFor(network);
    if (!fs.existsSync(f)) throw new Error(`No deployment info at ${f} — run a deploy script first.`);
    return JSON.parse(fs.readFileSync(f, "utf8")) as DeploymentInfo;
}

export function requireContractAddress(network: NetworkName, key: ContractKey): string {
    const addr = readDeploymentInfo(network).contracts[key];
    if (!addr) throw new Error(`deployment info for ${network} has no "${key}" address — deploy it first.`);
    return addr;
}

export function writeDeploymentInfo(network: NetworkName, patch: Partial<DeploymentInfo>): DeploymentInfo {
    fs.mkdirSync(outputDir, { recursive: true });
    const f = fileFor(network);
    const prev: DeploymentInfo = fs.existsSync(f)
        ? (JSON.parse(fs.readFileSync(f, "utf8")) as DeploymentInfo)
        : { network, deployedAt: new Date().toISOString(), contracts: {} };
    const next: DeploymentInfo = {
        ...prev,
        ...patch,
        network,
        deployedAt: new Date().toISOString(),
        contracts: { ...prev.contracts, ...(patch.contracts ?? {}) },
        domainTags: { ...(prev.domainTags ?? {}), ...(patch.domainTags ?? {}) },
    };
    fs.writeFileSync(f, JSON.stringify(next, null, 2) + "\n");
    console.log(`deployment info written → ${path.relative(process.cwd(), f)}`);
    return next;
}
