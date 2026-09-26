# CLAUDE.md

Guidance for Claude Code when working in `midnight/PNYX-Contract`.

## What this is

Compact (Midnight) port of `../../PNYX-Contract` (Solidity). Two contracts:

- `contracts/TournamentFinalizer.compact` — operator grants eligibility leaves; users finalize a
  tournament in ZK. On-chain per vote: nullifier + opaque commitment + champion tally + **7 match
  counters** (`matchLowWins`/`matchHighWins`, key `tid<<32|low<<16|high`) folded from the full bracket
  inside the circuit — so the anonymous bracket is public and match stats are unforgeable, while identity /
  B-design: the ENTIRE pick sequence is private — no public tally, no match counters. The bracket is
  sealed into the VoteRow commitment as `bracketHash`; the only public aggregate is `sampleCount`.
  Picks are revealed ONLY to a buyer (sellRows), who re-derives bracketHash→voteCommitment to verify. The grant leaf binds `bracketHash(bracket)`; submitting a bracket that
  differs from the granted one fails with `InvalidSigner`. Bracket circuits are size variants `finalizeTournament16/32/64` (`Vector<N, Uint<16>>` → `bracketHash{N}` sealed in the commitment via `finalizeCommon`; product offers 16/32/64 rounds). Also hosts the B2B data market
  (`registerBuyer`, `sellRows` — the single product; License records rowCount + sampleAtSale so the buyer can verify on-chain they got the full dataset as of the sale).
- `contracts/VotePointManager.compact` — operator grants settle intents; users consume them once.

Read `../SPEC.md` for the product rationale before changing circuit semantics.

## Commands

```bash
npm run compact:fast   # --skip-zk compile of both contracts (what tests need)
npm run compact        # full compile with proving keys (needed before deploy; ~1–2 min)
npm test               # vitest, 80 tests, all through compact-runtime simulators
npm run typecheck
npx vitest run -t "replay"          # single test by name
```

`compact` must be on PATH (`~/.local/bin`) and pinned: `compact update 0.31.1`. Do **not** bump the
compiler or `@midnight-ntwrk/compact-runtime` independently — compiler 0.31.1 ↔ runtime 0.16.0 ↔
`midnight-js` 4.1.1 ↔ `compact-js` 2.5.1 are a matched set (see README "Toolchain").

## Compact rules learned the hard way

- No `let` / mutable locals. Count with `fold(...)`, transform with `map(...)`, over fixed `Vector<N, T>`.
- Anything derived from a witness or a circuit parameter that touches the ledger (or `kernel.blockTime*`)
  must be wrapped in `disclose(...)`, including constructor args.
- A ledger read must not be *conditionally executed* on private data (`assert(!r.present || tree.checkRoot(..))`
  fails to compile). Evaluate the read unconditionally, then gate the assert (see `checkRow`).
- `assert(cond, "msg")` — message must be a string literal (no ternaries).
- `Map<K, Counter>.insertDefault(k)` **resets** an existing counter — guard with `member(k)` first.
- `ownPublicKey().bytes` is the caller identity (`msg.sender` analogue). Tests switch caller via
  `sim.as(wallet)`; block time via `sim.at(seconds)`.
- Merkle membership: user witness returns `MerkleTreePath` from `ledger.<tree>.findPathForLeaf(leaf)`,
  circuit checks `tree.checkRoot(merkleTreePathRoot<16, Bytes<32>>(path))` and `path.leaf == leaf`.
  Trees are `HistoricMerkleTree<16, _>` so older roots stay valid.
- `pure circuit`s are exported to TS as `pureCircuits.<name>(...)` — that is how the backend/tests
  compute leaves, nullifiers and commitments identically to the circuit.

## Tests

TDD: write the case in `test/*.test.ts` first, run (`RED`), then change the `.compact`, `npm run compact:fast`, run (`GREEN`).
`test/simulators/base.sim.ts` holds the deploy / `as()` / `at()` / `withPrivateState()` harness; per-contract
simulators wrap each circuit. Witness implementations live in `contracts/witnesses/` and are shared with scripts.
The Solidity suites' cases are mirrored 1:1 where semantics overlap (see describe-block names).

## Scripts

`scripts/lib/{config,wallet,contracts,session,deployment-info}.ts` mirror hardhat's networks / signer /
`getContractAt` / `deployment-info.json` roles. `--network` is mandatory. Wallet code is adapted from
`midnightntwrk/example-counter` (Apache-2.0). They have **not** been executed against preprod yet.
