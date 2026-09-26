# PNYX — Authentic Data Protocol on Midnight (Contracts)

Compact contracts for PNYX, a preference-data protocol that collects "A vs B" tournament votes, seals
them on [Midnight](https://midnight.network) with zero-knowledge proofs, and sells verified vote rows
under on-chain licenses. Built for the **Midnight Korea Hackathon 2026**; deployed on preprod.
Product rationale and the data-market process: [`docs/SPEC.md`](docs/SPEC.md).

| Repository | Role |
| --- | --- |
| [PNYX-FE-Midnight](https://github.com/DeSPELL-Admin/PNYX-FE-Midnight) | Next.js app: wallet login, play, in-browser proving of `finalizeTournament*`, market, buyer verification |
| [PNYX-BE-Midnight](https://github.com/DeSPELL-Admin/PNYX-BE-Midnight) | Operator API: `grantEligibility`, escrow, `registerBuyer` → `sellRows` fulfilment |
| **PNYX-Contract-Midnight** (this repo) | `TournamentFinalizer.compact`, `VotePointManager.compact`, simulator tests, deploy/interaction scripts |

The Solidity version of PNYX (EVM) was ported to Compact as follows:

| Solidity (legacy EVM)                       | Compact (Midnight)                                              |
| ------------------------------------------- | --------------------------------------------------------------- |
| backend EIP-712 signature verified on-chain | backend inserts an **eligibility leaf**; user proves membership in ZK |
| `tournamentData` emitted in a public event  | vote stored as an **opaque commitment**; champion/bracket/segment never reach the ledger |
| `nonces[user]` replay guard                 | per-(user, tournament) **nullifier**                            |
| events                                      | counters + `licenses` map (queryable)                           |
| `Ownable` + `setFinalizeSigner`             | `owner` (deployer coin pk) + `setFinalizeSigner` / `setDomainTag` |
| —                                           | **data market**: `registerBuyer`, `sellRows` → `License`        |

## Toolchain (pinned — the officially documented combination)

| Tool                              | Version | Why                                                          |
| --------------------------------- | ------- | ------------------------------------------------------------ |
| `compact` CLI / compiler          | 0.31.1  | emits code for `@midnight-ntwrk/compact-runtime` **0.16.0**  |
| `@midnight-ntwrk/compact-runtime` | 0.16.0  | what `midnight-js` 4.1.1 / `compact-js` 2.5.1 pin            |
| `@midnight-ntwrk/midnight-js`     | 4.1.1   | latest stable; 5.0 betas target runtime 0.19 + ledger-v9 and have no matching wallet SDK yet |
| `@midnight-ntwrk/ledger-v8`       | 8.1.0   |                                                              |
| `@midnight-ntwrk/onchain-runtime-v3` | **3.0.0 (pinned)** | `midnight-js-protocol` pins 3.0.0; letting npm pull 3.1.0 at top level gives two WASM instances → `expected instance of StateValue` on every call tx |
| `@midnight-ntwrk/wallet-sdk-*`    | stable  | facade 4.0.1, shielded 3.0.1, unshielded 3.1.0, dust 4.1.0, hd 3.0.2, address-format 3.1.2 |
| proof server (docker)             | 8.1.0   | `npm run proof-server`                                        |
| Node                              | **22.13+ or 24 LTS** | Node 25 OOMs (4 GB heap) during preprod wallet sync. npm 10.9.0 (Node ≤ 22.11) skips rolldown's optional native binding on `npm ci` and vitest fails with `Cannot find native binding` — use Node 22.13+/24 or `npm install -g npm@latest` |

Newer `compact` (0.34) compiles fine and the test-suite also passes on runtime 0.19, but no
published `midnight-js` + wallet-SDK pair exists for it yet — so deployment scripts would not build.

```bash
# one-time
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
compact update 0.31.1
npm install
```

## Commands

```bash
npm run compact:fast   # compile both contracts, skip proving keys (seconds) — enough for tests
npm run compact        # full compile incl. proving keys (~1–2 min) — required before deploying
npm test               # vitest simulator suite (77 tests)
npm run test:compile   # compact:fast + test
npm run typecheck
```

Deploy / interact (every script needs `--network <standalone|preview|preprod>`; see `.env.example`):

```bash
npm run proof-server                                                # in another terminal
npx tsx scripts/deploy.ts --network preprod                          # writes scripts/output/preprod-deployment-info.json
npx tsx scripts/deployVotePointManager.ts --network preprod

USER_PK=<64hex> npx tsx scripts/tournamentFinalizer/grantEligibility.ts --network preprod 7 100 1893456000
USER_SECRET=… VOTE_SALT=… npx tsx scripts/tournamentFinalizer/finalizeTournament.ts --network preprod <tournamentId> <point> <deadlineUnix> <segment> <bracket: 16|32|64 item ids>
npx tsx scripts/dataMarket/registerBuyer.ts --network preprod <buyerPk>
```

## Layout

```
contracts/
  TournamentFinalizer.compact      eligibility · ZK vote commitment · nullifier · data market (sellRows / License)
  VotePointManager.compact         settle grants · settle · public settlement record (not used by the current app)
  witnesses/*.witnesses.ts         private state types + witness implementations (shared by tests & scripts)
  managed/<Name>/                  compiler output (gitignored): contract/, zkir/, keys/
test/
  simulators/base.sim.ts           deploy / as(wallet) / at(time) harness on compact-runtime
  simulators/*.sim.ts              per-contract simulators
  TournamentFinalizer.test.ts      mirrors the Solidity suite + ZK-specific cases
  VotePointManager.test.ts         mirrors the Solidity suite
  DataMarket.test.ts               B2B purchase flow
scripts/
  lib/                             config (networks), wallet, providers, deployment-info
  deploy.ts, deployVotePointManager.ts
  tournamentFinalizer/, votePointManager/, dataMarket/
  output/<network>-deployment-info.json
docs/SPEC.md                       product / privacy design rationale
```

## Contract model

### TournamentFinalizer

```
operator (finalizeSigner)             user (browser)                              ledger
──────────────────────────            ──────────────────────────────────          ─────────────────────────────
leaf = eligibilityLeaf(               finalizeTournament16|32|64(tid, point,      eligibility: HistoricMerkleTree<16>
  domainTag, userPublicKey(secret),     deadline, bracket, segment)               nullifiers:  Set
  tid, point, deadline, bracketHash)    ├ witness userSecret, voteSalt             voteCommits: HistoricMerkleTree<16>
grantEligibility(leaf) ──────────►      ├ witness eligibilityPath(leaf)            sampleCount: Map<tid, Counter>
                                        ├ assert blockTime ≤ deadline
                                        ├ assert path ∈ eligibility (checkRoot)
                                        ├ nullifier = H(secret, tid)     ──►      (opaque)
                                        ├ commit = H(VoteRow{tid, item, bracketHash, segment}, salt) ──► (opaque)
                                        └ sampleCount[tid]++             ──►      (public)
```

Public on-chain: the eligibility root, nullifiers, sealed commitments, `sampleCount`, buyers and licenses.
Private (witness): `userSecret`, `voteSalt`, the Merkle path, the champion and the whole bracket. The grant
leaf binds `bracketHash(bracket)`, so only the exact bracket the backend validated can be finalized;
any other bracket fails with `InvalidSigner`. Bracket sizes are separate circuits (`Vector<16|32|64, Uint<16>>`).
The `pure circuit`s (`userPublicKey`, `eligibilityLeaf`, `voteNullifier`, `voteCommitment`,
`bracketHash16/32/64`, `licenseId`) are exported to TypeScript as `pureCircuits.*` so the backend and the
buyer-side verifier compute exactly what the circuit does.

### Data market (same contract)

| circuit          | who      | proves / records                                                                           |
| ---------------- | -------- | ------------------------------------------------------------------------------------------ |
| `registerBuyer`  | operator | registers the buyer delivery key (`buyers` set)                                            |
| `sellRows`       | operator | every escrowed row of the batch is on-chain (`voteCommits.checkRoot` per row) — the picks are revealed only to the buyer; writes a `License { buyerPk, tournamentId, specHash, rowCount, sampleAtSale, datasetHash }` |

A buyer verifies "full and untampered" from the License alone: `rowCount` vs `sampleAtSale`
(the on-chain `sampleCount` at the moment of sale), `datasetHash` vs the downloaded bytes, and per row
`voteCommitment(row, salt)` ∈ `voteCommits`. Each `sellRows` proof covers one batch of `ESCROW_BATCH = 8`
rows (`sellRows.prover` ≈ 38 MB).

### VotePointManager

`grantSettle(leaf)` by the operator, then `settle(tid, itemId, amount, option, deadline, nonce)` by the
user. Deployed alongside but not wired into the current application.

## Error names

Assertion messages keep the Solidity custom-error names so the test suites line up:
`ZeroAddress`, `ValueUnchanged`, `NotOwner`, `NotSigner`, `ExpiredSignature`, `InvalidSigner`,
`AlreadyFinalized` / `NonceConsumed` (replay), `BuyerNotRegistered`, `LicenseExists`,
`WrongTournament`, `RowNotOnChain`, `EmptyDataset`. Failures surface as `Error("failed assert: <name>")`.

## Preprod deployment

Current deployment (`scripts/output/preprod-deployment-info.json`, 2026-09-01):

| contract            | address                                                            |
| ------------------- | ------------------------------------------------------------------ |
| TournamentFinalizer | `1fe82f185fe7187ef335365c1ccf9fa7bc47b7a03fab84372d70c73262d00249` |
| VotePointManager    | `350a14d9c9c07951d749607268036577f803f4f659e112bde0bf41f644eee3d8` |

Exercised end to end from the app on preprod: `grantEligibility` → `finalizeTournament16` (browser proof)
→ `registerBuyer` → `sellRows` → License verified by the buyer against the downloaded dataset.

### Wallet sync notes (hard-won)

- A fresh preprod wallet replays ~1.46 M dust events and ~1.46 M zswap events. With the SDK default
  batch size (10) that is ~35 h; `batchUpdates: { size: 2000 }` (set in `scripts/lib/wallet.ts`) brings
  it to ~30 min at ~0.5 GB RSS.
- The scripts only wait for **unshielded + dust** to sync (`isReady` in `wallet.ts`); the shielded
  wallet holds no coins here and its websocket drops mid-sync are harmless. `MIDNIGHT_WAIT_SHIELDED=1`
  restores the strict behaviour.
- After each sync the three sub-wallet states are checkpointed to
  `scripts/output/wallet-state-preprod.json` (gitignored) and restored on the next run, so every
  later script starts in seconds. Delete the file to force a full resync.
- Run long syncs detached (`nohup … &`), not inside a tool/CI step with a 30-min cap.
- `npm run compact:fast` (`--skip-zk`) **deletes proving keys**; run `npm run compact` before deploying.

## Known limitations

- `sellRows` proves one batch per license; multi-batch licenses are a follow-up.
- `datasetHash` is bound but not verified in-circuit; the buyer verifies it off-chain.
- The operator holds the escrowed rows in plaintext until sale. Threshold decryption is roadmap (SPEC §3.2).
