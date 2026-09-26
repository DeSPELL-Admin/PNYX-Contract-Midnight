# PNYX × Midnight — 해커톤 기획서

> **한 줄 요약**: 이상형 월드컵의 개별 투표는 유저 브라우저에서 ZK 커밋되어 아무도(PNYX 포함) 볼 수 없고, 구매자는 "온체인 커밋과 1:1 대응되는, 동의 범위 내의, 조작 불가능한" 투표 데이터를 검증 가능한 형태로 구매한다.

- 작성일: 2026-08-29
- 대상: Midnight Korea 해커톤 (https://docs.midnightkorea.org)
- 기준 코드: `PNYX-Contract` (Solidity, legacy EVM), `PNYX-BE` (NestJS + ethers 6), `PNYX-FE` (Next.js + wagmi 2 + RainbowKit + SIWE)
- 결정 사항 (대화에서 확정)
  - FE **디자인·컴포넌트 유지**, 지갑 프로바이더만 wagmi → Midnight.js + Lace 로 교체 (비수탁형)
  - 기존 EVM 스캐너 및 서명 스택은 제거하고, 해커톤용 Midnight 코드는 이 `midnight/` 폴더 아래 구성
  - 투표 내용 자체를 ZK 커밋 (백엔드 서명을 ZK하는 방식은 채택 안 함)
  - 백엔드 EIP-712 서명은 "참가 자격 증명" witness 로 흡수

---

## 1. 문제 정의

### 1.1 현재 구조의 한계

`PNYX-Contract/contracts/TournamentFinalizer.sol:127` 와 `VotePointManager.sol:130` 은 유저 주소·토너먼트 진행 경로(`tournamentData`)·아이템 선택을 **평문 이벤트**로 emit 한다.

| 문제 | 영향 |
|---|---|
| 투표 원본이 퍼블릭 로그에 노출 | B2B 로 팔려는 데이터를 누구나 무료로 재구성 가능 |
| 체인이 증명하는 것은 "PNYX 서명 존재" 뿐 | 구매자는 PNYX 를 신뢰해야만 함 (trusted oracle) |
| 유저 동의 범위가 어디에도 기록되지 않음 | 개인정보 규제 대응 근거 부재 |

### 1.2 Midnight 로 해결되는 것 / 안 되는 것

| 항목 | Midnight | 비고 |
|---|---|---|
| 개별 투표 비공개 | ✅ | private-by-default, `disclose` 안 하면 체인에 안 남음 |
| 집계 정직성 증명 | ✅ | `tally++` 가 circuit 안에서 실행 |
| 중복 투표 방지 (비공개) | ✅ | nullifier |
| "PNYX 도 못 본다" | ✅ | 증명이 유저 브라우저에서 생성됨 (비수탁형이므로) |
| 미정 구매자에게 나중에 전달 | ⚠️ 설계 필요 | 투표 시엔 **동의 범위**만 커밋, 판매 시 증명으로 전달 (§4) |
| 저수준 회로 작성 불필요 | ✅ | Compact 컴파일러가 zkir/키 생성 |
| 커밋먼트/널리파이어 패턴 자동 | ❌ | 개발자가 Compact 로 직접 작성 |
| EVM/Solidity 호환 | ❌ | 전면 재작성 (비EVM) |

---

## 2. 제품 스코프 (해커톤 데모)

### 2.1 데모 시나리오 (심사용 5분)

1. **유저 화면** — 기존 PNYX UI 그대로. Lace 지갑 연결 → 이상형 월드컵 플레이(16/32/64강) → 완료 시 "ZK 증명 생성 중" → Midnight explorer 링크
2. **체인 화면** — explorer 에서 tx 확인: 커밋 해시와 nullifier 만 보이고 선택 내용은 없음
3. **구매자 콘솔** — 세그먼트 쿼리 입력 → 견적(표본 수·가격) → 결제(mock) → 라이선스 발행 tx → 데이터 수령
4. **검증 CLI** — 구매자가 받은 데이터로 `pnyx-verify` 실행 → 모든 로우가 온체인 커밋과 매칭 → 초록불
5. **마무리** — "PNYX 도 개별 투표를 볼 수 없지만, 구매자는 데이터가 진짜임을 수학적으로 검증한다"

### 2.2 포함 / 제외

| 포함 | 제외 (로드맵으로 언급) |
|---|---|
| castVote / sellAggregate / sellSegment / sellRows / issueLicense | 실결제 (tNIGHT 전송으로 mock) |
| 동의 등급 3단계 | 동의 철회 |
| k-anonymity (k=30) | 차분 프라이버시 |
| Lace 연결 (플랜B: headless wallet) | PNYX 도 못 보는 원본 escrow (threshold 복호화) |
| 구매자 검증 CLI | 구매자 SDK 패키지 배포 |
| 단일 토너먼트 | 멀티 토너먼트 조인 쿼리 |

---

> **⚠️ 2026-08-31 단일 상품 재설계 반영** — 아래 3~5장의 consent 3등급(aggregate/segment/rows)·k-익명성 설계는 **폐기**되었다.
> 확정 설계: 제출된 모든 투표는 판매 대상(선택 UI 없음). 상품은 `sellRows` 하나 — 구매자는 토너먼트의 **현재시점 전체 로우**를 구매하고,
> License 의 `rowCount`/`sampleAtSale`(판매 순간의 온체인 sampleCount)로 "전량 수령"을 체인에서 검증한다.
> `sellAggregate`/`sellSegment`/`setKAnonymity`/`kAnonymity` 는 회로에서 제거됨. 집계 통계는 공개 ledger(`tally`·`matchLowWins/HighWins`)로 무료 제공.
> 최신 구현 기준은 §12 현황 표와 각 레포 CLAUDE.md.

## 3. 시스템 아키텍처

```
┌──────────────── 유저 브라우저 ────────────────┐
│ PNYX-FE (디자인 유지)                          │
│  ├ Lace (Midnight) 지갑                        │
│  ├ private state: { userSecret, votes[] }      │
│  └ Midnight.js → castVote(witness)             │
│         │ witness 는 로컬, 증명 요청만 전송       │
│         ▼                                      │
│    Proof Server (PNYX 호스팅, 데모용)           │
└────────────────────┬───────────────────────────┘
                     │ tx
                     ▼
┌──────────── Midnight (preprod) ───────────────┐
│ PnyxDataMarket.compact                        │
│  ledger: voteCommits(Merkle) · nullifiers     │
│          tally · licenses · buyers            │
└────────────────────┬───────────────────────────┘
                     │ indexer (GraphQL)
                     ▼
┌──────────────── PNYX-BE ──────────────────────┐
│  eligibility/  : 참가 자격 토큰 발급 (기존 서명 재활용) │
│  escrow/       : 유저가 위탁한 암호화 로우 보관     │
│  data-market/  : quote → license → prove → deliver │
│  midnight/     : indexer 클라이언트, BE 지갑, proof │
└───────────────────────────────────────────────┘
                     │
                     ▼
┌──────── 구매자 ────────┐
│ 콘솔 (간단 페이지)      │
│ pnyx-verify CLI        │
└────────────────────────┘
```

### 3.1 신뢰 경계

| 데이터 | 유저 | PNYX | 체인 | 구매자 |
|---|---|---|---|---|
| 개별 선택 (itemId) | 원본 | ❌ (escrow 는 §3.2 참고) | 커밋만 | 동의 등급 3 로우만 |
| 동의 등급 | 결정 | 확인 가능 | 커밋 안에 | 간접 (받은 로우로 추론) |
| 집계 tally | — | 조회 | 공개 | 공개 |
| 판매 이력 | — | 기록 | 공개 | 공개 |

### 3.2 escrow 에 대한 솔직한 정리

비수탁형이라 투표 시점엔 PNYX 가 원본을 못 본다. 그러나 **로우레벨 판매(등급 3)를 하려면 누군가 원본을 보관해야** 한다. 해커톤 버전 결정:

- 유저가 `consent=3` 을 선택한 경우에만, FE 가 로우 `(itemId, consent, segment, salt)` 를 **PNYX escrow 공개키로 암호화**해 BE 에 위탁
- `consent ≤ 2` 로우는 위탁 자체를 안 함 → PNYX 도 영원히 모름
- 즉 "PNYX 가 원본을 보는 범위 = 유저가 로우 판매에 동의한 범위" 로 일치시킴
- 피치에서는 "등급 3 escrow 의 PNYX 열람 불가(threshold 복호화)는 로드맵" 으로 명시

---

## 4. 컨트랙트 설계 (Compact)

파일: `midnight/contract/src/PnyxDataMarket.compact`

> 아래는 설계 의사코드. 실제 Compact 표준 라이브러리 API 명(`MerkleTree.checkRoot`, `persistentCommit` 시그니처 등)은 D3 에 확인 후 수정.

### 4.1 Ledger

```ts
export ledger voteCommits: MerkleTree<20, Bytes<32>>;   // 투표 커밋 (최대 2^20)
export ledger nullifiers:  Set<Bytes<32>>;               // (userSecret, tournamentId) 파생
export ledger tally:       Map<Uint<32>, Counter>;       // key = tournamentId<<16 | itemId
export ledger sampleCount: Map<Uint<16>, Counter>;       // 토너먼트별 표본 수
export ledger buyers:      Map<Bytes<32>, Bytes<32>>;    // buyerPk → kycHash
export ledger licenses:    Map<Bytes<32>, License>;      // licenseId → License
export ledger operator:    Bytes<32>;                    // PNYX 운영 키 (판매 회로 호출 권한)
```

```ts
struct License {
  buyerPk:       Bytes<32>;
  tournamentId:  Uint<16>;
  scope:         Uint<8>;     // 1=aggregate 2=segment 3=rows
  querySpecHash: Bytes<32>;   // 요청 스펙 해시 (재현 가능성)
  datasetHash:   Bytes<32>;   // rows 일 때 암호화 파일 해시, 아니면 0
  rowCount:      Uint<32>;
  issuedAt:      Uint<64>;
}
```

### 4.2 Witness (private)

```ts
// 유저 측
witness userSecret(): Bytes<32>;                       // Lace 에서 파생, 로컬 보관
witness voteSalt(): Bytes<32>;
witness eligibilityToken(): Bytes<64>;                 // PNYX-BE 가 발급한 참가 자격 서명

// PNYX 측 (판매 회로)
witness escrowRows(tournamentId: Uint<16>): Vector<256, Row>;
struct Row {
  itemId: Uint<16>; consent: Uint<8>; segment: Bytes<32>; salt: Bytes<32>;
  path: MerklePath<20, Bytes<32>>;
}
```

### 4.3 Circuits

#### `castVote` — 유저 호출

```ts
export circuit castVote(
  tournamentId: Uint<16>,
  itemId:       Uint<16>,
  consent:      Uint<8>,       // 1 | 2 | 3
  segment:      Bytes<32>      // hash(ageBand, gender) — consent≥2 일 때만 의미
): [] {
  const secret = userSecret();
  const salt   = voteSalt();

  // (a) 참가 자격: PNYX-BE 서명 검증 (기존 EIP-712 서명의 역할을 흡수)
  assert(verifyEligibility(eligibilityToken(), operator, tournamentId, secret), "not eligible");

  // (b) 중복 방지
  const nul = persistentHash<Vector<2, Bytes<32>>>([secret, pad(32, tournamentId)]);
  assert(!nullifiers.member(nul), "already voted");
  nullifiers.insert(nul);

  // (c) 커밋
  assert(consent >= 1 && consent <= 3, "bad consent");
  const c = persistentCommit<Row>({ itemId, consent, segment, salt }, secret);
  voteCommits.insert(c);

  // (d) 집계 (회로 안 → 조작 불가)
  tally.lookup(pad(32, tournamentId) * 65536 + pad(32, itemId)).increment(1);
  sampleCount.lookup(tournamentId).increment(1);
  // itemId / consent / segment / secret 은 disclose 안 함
}
```

#### `registerBuyer` — PNYX 호출

```ts
export circuit registerBuyer(buyerPk: Bytes<32>, kycHash: Bytes<32>): [] {
  assert(isOperator(), "not operator");
  buyers.insert(buyerPk, kycHash);
}
```

#### `sellAggregate` — scope 1

```ts
export circuit sellAggregate(buyerPk: Bytes<32>, tournamentId: Uint<16>, specHash: Bytes<32>): [] {
  assert(isOperator() && buyers.member(buyerPk), "bad buyer");
  // tally 는 이미 public. 라이선스만 기록
  const id = persistentHash([buyerPk, pad(32, tournamentId), specHash]);
  licenses.insert(id, License { buyerPk, tournamentId, scope: 1, querySpecHash: specHash,
                                datasetHash: 0, rowCount: sampleCount.lookup(tournamentId).read(), issuedAt: now() });
}
```

#### `sellSegment` — scope 2, 숫자만 공개

```ts
export circuit sellSegment(
  buyerPk: Bytes<32>, tournamentId: Uint<16>, segment: Bytes<32>, itemId: Uint<16>, specHash: Bytes<32>
): Uint<32> {
  assert(isOperator() && buyers.member(buyerPk), "bad buyer");
  const rows = escrowRows(tournamentId);
  let matched: Uint<32> = 0;
  let sample:  Uint<32> = 0;
  for (const r of rows) {
    if (r.itemId == 0) continue;                        // padding
    assert(voteCommits.checkRoot(merkleRoot(r.path, persistentCommit(r))), "row not on-chain");
    assert(r.consent >= 2, "no segment consent");
    if (r.segment == segment) { sample += 1; if (r.itemId == itemId) matched += 1; }
  }
  assert(sample >= 30, "k-anonymity");                  // §5.3
  const id = persistentHash([buyerPk, pad(32, tournamentId), specHash]);
  licenses.insert(id, License { ..., scope: 2, rowCount: sample, datasetHash: 0 });
  return disclose(matched);
}
```

#### `sellRows` — scope 3, 해시만 공개

```ts
export circuit sellRows(
  buyerPk: Bytes<32>, tournamentId: Uint<16>, specHash: Bytes<32>, datasetHash: Bytes<32>
): [] {
  assert(isOperator() && buyers.member(buyerPk), "bad buyer");
  const rows = escrowRows(tournamentId);
  let n: Uint<32> = 0;
  for (const r of rows) {
    if (r.itemId == 0) continue;
    assert(voteCommits.checkRoot(merkleRoot(r.path, persistentCommit(r))), "row not on-chain");
    assert(r.consent == 3, "no row consent");
    n += 1;
  }
  // datasetHash = hash(encrypt(rows, buyerPk)) 는 회로 밖(TS)에서 계산 후 인자로 전달.
  // 회로는 "전달된 로우 집합이 모두 온체인·동의 3" 임을 보증하고, 해시는 라이선스에 박아 위변조 탐지.
  assert(rowsDigest(rows) == witnessDigest(datasetHash), "dataset mismatch");
  const id = persistentHash([buyerPk, pad(32, tournamentId), specHash]);
  licenses.insert(id, License { ..., scope: 3, rowCount: n, datasetHash });
}
```

### 4.4 Compact 제약과 대응

| 제약 | 대응 |
|---|---|
| `Vector<N>` 고정 크기 | 배치 256 로우/증명. 라이선스에 배치 목록 (`datasetHash` 를 배치 해시들의 Merkle root 로) |
| 회로 안 암호화 비용 | 암호화는 TS 에서, 회로는 digest 대조만 |
| 루프 내 조건부 assert 비용 | padding 로우는 `itemId == 0` 으로 스킵 |
| 증명 시간 | 256 로우 기준 목표 < 60s (첫날 실측 후 N 조정) |

---

## 5. 데이터 판매 프로세스

### 5.1 상태 머신 (BE)

```
REQUESTED → QUOTED ─┬→ PAID → LICENSED → PROVING → DELIVERED → VERIFIED
                    ├→ REJECTED_K_ANON
                    └→ REJECTED_CONSENT           PROVING → PROOF_FAILED (환불+알림)
```

### 5.2 단계별 책임

| # | 단계 | 주체 | 온/오프 | 내용 |
|---|---|---|---|---|
| 1 | 구매자 등록 | 구매자→PNYX | 온 | x25519 키쌍 로컬 생성, `buyerPk` 제출. `registerBuyer` |
| 2 | 요청 | 구매자 | 오프 | QuerySpec JSON (§5.4) |
| 3 | 견적·사전검증 | BE | 오프 | escrow 드라이런: 표본 수, 동의 등급 필터, k 검사, 가격 |
| 4 | 결제·라이선스 | 구매자→BE | 온 | 결제(mock) 후 `sell*` 회로 호출 → `licenses` 기록 |
| 5 | 증명 | BE + Proof Server | 오프→온 | witness = escrow 로우. 배치별 증명 |
| 6 | 전달 | BE | 오프 | scope 별 (§5.5). 서명된 URL 24h |
| 7 | 검증 | 구매자 | 로컬 | `pnyx-verify` (§6.4) |
| 8 | 이력 | — | 온 | `licenses` 영구. 배치 해시 = 누출 추적 워터마크 |

### 5.3 프라이버시 가드

- **k-anonymity**: 세그먼트 판매 표본 ≥ 30. 회로 안 assert 라 PNYX 도 우회 불가
- **동의 등급 강제**: `consent` 검사 회로 안. 등급 미달 로우 포함 시 증명 실패
- **세그먼트 조합 폭발 방지**: 견적 단계에서 세그먼트 키를 `hash(ageBand, gender)` 2축으로 제한 (해커톤 범위)

### 5.4 QuerySpec

```json
{
  "tournamentId": 12,
  "scope": "segment",
  "filters": { "ageBand": "20s", "gender": "F" },
  "itemId": 7,
  "fields": ["itemId", "segment"]
}
```

`specHash = sha256(canonicalJson(spec))` → 라이선스에 기록 → 구매자가 "내가 산 스펙" 을 온체인으로 재확인 가능.

### 5.5 전달물

| scope | 전달 | 검증 포인트 |
|---|---|---|
| 1 aggregate | tally 조회 링크 + licenseId | 체인 직접 조회 |
| 2 segment | `matched`, `sample`, 증명 tx | tx 의 disclose 값 = 받은 값 |
| 3 rows | `buyerPk` 암호화 파일 + 배치 해시 목록 + 증명 tx | 복호화 → 각 로우 commit 재계산 → Merkle 포함 확인 → 파일 해시 = `datasetHash` |

---

## 6. 컴포넌트별 변경 계획

### 6.1 FE (`PNYX-FE`, 디자인 유지)

원칙: **`useWallet()` 어댑터 한 겹**을 만들어 표시용 컴포넌트는 훅 이름만 바꾼다.

| 구분 | 파일 | 작업 |
|---|---|---|
| 교체 | `app/providers.tsx`, `components/providers/WagmiProvider.tsx` | `MidnightProvider` (Midnight.js + Lace 커넥터) |
| 교체 | `lib/chains.ts`, `lib/contract.ts`, `lib/abis/TournamentFinalizer.ts` | preprod 설정, 컴파일된 `managed/` 컨트랙트 API |
| 교체 | `hooks/contract/useContractWriteWithReceipt.ts`, `useSmartAccount.ts` | `useCastVote()` — witness 구성 → proof server → submit |
| 인증 | `lib/auth/siwe.ts`, `walletStorage.ts`, `hooks/auth/useAuthSession.ts`, `components/auth/{SessionProvider,AuthGuard,AutoConnect}.tsx`, `app/login/page.tsx` | SIWE → Lace 주소 + 챌린지 서명 세션 |
| 훅 시그니처 | `hooks/tournaments/{index,useGameLogic}.ts`, `hooks/useSupportedChainGuard.ts` | `useAccount` → `useWallet` |
| 표시만 | `app/page.tsx`, `tournament/[id]/**`, `mypage/**`, `hall/**`, `components/modals/*` (~15개) | 훅 이름 변경만. 디자인 무변경 |
| 삭제 | `components/NetworkSwitcher.tsx`, `hooks/ens/*`, `lib/ens/*` | Midnight 에 해당 개념 없음 |
| 신규 | `components/ProofPending.tsx` | "ZK 증명 생성 중" 상태. 기존 로딩 컴포넌트 재사용 |
| 신규 | `app/tournament/[id]/_components/ConsentPicker.tsx` | 투표 완료 전 동의 등급 선택 (3단계 라디오, 기존 모달 스타일) |
| 신규 | `lib/midnight/privateState.ts` | `userSecret`, `votes[]` 로컬 보관 (IndexedDB) |
| 신규 | `lib/midnight/escrow.ts` | consent=3 일 때 escrow 공개키로 암호화 → BE 위탁 |

### 6.2 BE (`PNYX-BE`, 기존 모듈 옆에 추가)

```
src/module/midnight/
  ├ midnight.module.ts
  ├ indexer.client.ts         # GraphQL: commits, tally, licenses 조회
  ├ operator-wallet.ts        # PNYX 운영 지갑 (DUST 보유), sell* 호출
  └ proof.client.ts           # Proof Server HTTP
src/module/eligibility/
  ├ eligibility.service.ts    # 기존 signature.service 재활용 → eligibilityToken 발급
  └ eligibility.controller.ts # POST /eligibility/:tournamentId
src/module/escrow/
  ├ escrow.schema.ts          # { tournamentId, commit, ciphertext, consent } — consent=3 만
  └ escrow.controller.ts      # POST /escrow (FE 위탁)
src/module/data-market/
  ├ buyer.service.ts          # registerBuyer
  ├ quote.service.ts          # 드라이런 + 가격
  ├ license.service.ts        # 결제(mock) → sell* 호출
  ├ prover.service.ts         # 배치 witness 구성, 증명, 재시도
  ├ delivery.service.ts       # 암호화·서명 URL
  └ data-market.controller.ts
src/module/auth-midnight/
  └ challenge.service.ts      # SIWE 대체: nonce 챌린지 + Lace 서명 검증
```

기존 EVM `signature/`, `scanner/` 서브시스템은 제거되었으며, 백엔드는 Midnight 전용으로 운영한다.

### 6.3 컨트랙트 (`midnight/contract/`)

```
midnight/contract/
  ├ src/PnyxDataMarket.compact
  ├ src/witnesses.ts            # 유저/운영자 witness 구현
  ├ managed/                    # 컴파일 산출물 (contract, keys, zkir)
  ├ test/                       # Compact 단위 테스트 (시뮬레이터)
  └ scripts/deploy.ts
```

### 6.4 구매자 도구 (`midnight/buyer/`)

```
midnight/buyer/
  ├ console/                    # Next.js 단일 페이지: 요청 → 견적 → 결제 → 수령
  └ cli/pnyx-verify             # 복호화 → commit 재계산 → indexer 대조 → 리포트
```

`pnyx-verify` 출력 예:

```
license   0x8f3a…  scope=rows  tournament=12  rows=214
dataset   sha256 OK (matches on-chain datasetHash)
commits   214/214 found in voteCommits (root 0x2c9e…)
consent   214/214 == 3
RESULT    VERIFIED ✅
```

---

## 7. 일정 (1명 풀타임 기준, 12~15일 + 버퍼 3일)

| D | 작업 | 산출물 / 완료 기준 |
|---|---|---|
| 1–2 | 환경: Compact 컴파일러, Proof Server(Docker), preprod 지갑, faucet, 예제 `bboard` 배포 성공 | preprod 에 bboard tx 1건 |
| 3–6 | `PnyxDataMarket.compact` + 시뮬레이터 테스트 | castVote / sell* 전부 테스트 통과, 256 로우 증명 시간 실측 |
| 7–9 | FE: MidnightProvider, 인증 교체, `useWallet` 어댑터, `useCastVote`, ConsentPicker, ProofPending | 기존 UI 로 완주(16/32/64강) → preprod tx |
| 9–11 | BE: eligibility, escrow, auth-midnight, data-market(quote/license/prover/delivery) | 콘솔에서 segment 구매 → 라이선스 tx |
| 12–13 | 구매자 콘솔 + `pnyx-verify` | rows 구매 → CLI VERIFIED |
| 14–15 | 통합, 데모 시나리오 리허설, 영상, 피치 덱 | 5분 데모 영상 |
| +3 | 버퍼 (툴체인 버전 이슈, 증명 시간 튜닝) | — |

**첫날 확인 필수 (플랜B 트리거)**
- Lace Midnight 확장이 preprod 에서 동작하는가 → 아니면 SDK headless wallet 로 데모, Lace 는 영상에서만
- 브라우저→호스팅 proof server 왕복이 60s 이내인가 → 아니면 배치 N 축소

---

## 8. 리스크

| 리스크 | 확률 | 대응 |
|---|---|---|
| Midnight 툴체인 버전 깨짐 (federated 단계) | **현실화** | 2026-08-29 확인: `compact` 0.34 는 runtime 0.19 를 내지만 배포 스택(`midnight-js` 4.1.1 · wallet-sdk 안정판)은 runtime 0.16 · ledger-v8 고정, 5.0 베타는 ledger-v9 로 넘어가는 중이라 지갑 SDK 와 불일치. → **compact 0.31.1 + runtime 0.16.0 + midnight-js 4.1.1** 로 고정 (`PNYX-Contract/README.md` Toolchain 표). 컴파일러/런타임 단독 업그레이드 금지 |
| Merkle 검증 API 가 예상과 다름 | 중 | D3 에 API 확인 후 §4 수정 |
| 증명 시간 과다 | 중 | 배치 축소, 데모는 소량 로우 |
| Lace 미지원 | 중 | headless wallet 플랜B |
| 심사 Q&A "PNYX 가 escrow 를 보지 않나" | 높 | §3.2 대로 "등급 3 = 유저가 로우 판매 동의한 범위" 로 선제 설명 |

---

## 9. 피치 핵심 메시지

1. **모순을 푼다** — "프라이버시 체인 위에서 데이터를 판다" 는 모순을 *동의 기반 · 검증 가능 집계* 로 해결
2. **상품이 바뀐다** — "PNYX 가 수집했다는 데이터" → "체인이 보증하는 데이터". 구매자의 검증 비용이 0 이 됨
3. **Web2 UX 유지** — 디자인·플로우 그대로, 지갑만 교체. 실제 서비스 도입 가능성
4. **정직한 한계** — 등급 3 escrow 는 PNYX 가 보관 (threshold 복호화는 로드맵)

---

## 9.5 구현 현황 (2026-08-29)

`midnight/PNYX-Contract/` — §4 컨트랙트와 §5 판매 프로세스의 온체인 부분을 TDD 로 구현 완료.

| 항목 | 상태 |
|---|---|
| `TournamentFinalizer.compact` (eligibility · ZK 투표 · tally · **온체인 매치 카운터** · 데이터 마켓 4 회로) | ✅ 2026-08-31 재설계: 브라켓 전체를 회로 인자로 받아 매치 N-1개를 접어 올림(`matchLowWins/HighWins`), grant leaf 에 `bracketHash` 바인딩(브라켓 위조 차단). ~~대진표는 익명 공개~~ → **2026-09-01 B-design: 선택 전체 비공개**. 사이즈 변형 `finalizeTournament16/32/64`. **B-design(최종)**: 공개 tally·매치 카운터 전부 제거 — 브라켓 전체가 `bracketHash` 로 VoteRow 커밋 안에 봉인되어 **판매 전까지 그 누구도 선택을 볼 수 없다**. 온체인 공개는 참여 수(sampleCount)뿐. 구매자는 로우의 bracket 원문으로 bracketHash→voteCommitment 를 재계산해 온체인 커밋과 대조(위조 불가). prover 9.5/9.6/19MB. 컨트랙트 `1fe82f18…62d00249`. **2026-08-31 단일 상품 재설계**: consent 3등급 제거 — 제출 = 전량 판매 대상, 상품은 `sellRows` 하나(토너먼트의 현재까지 전체 로우 + License 에 rowCount·sampleAtSale 기록 → 구매자가 rowCount==sampleAtSale 로 "현시점 전량" 온체인 검증). sellAggregate/sellSegment/setKAnonymity/kAnonymity 삭제. **2026-09-01 구매 마켓 구현 완료**(`docs/market-dev-plan.md`): FE `/market`(상품·Lace tNIGHT 실결제)+`/market/orders/[id]`(진행 타임라인+무신뢰 검증 패널), BE `/chains/99101/market/*`(주문·자동 fulfill 직렬 큐: registerBuyer→pin→sellRows→License 확인). E2E 실측: 주문→결제→sellRows tx `00963d33…`→다운로드 sha256==온체인 datasetHash 일치 |
| `VotePointManager.compact` (settle grant · settle · 공개 정산 기록) | ✅ |
| vitest 시뮬레이터 테스트 | ✅ 80/80 — 기존 Solidity 테스트 케이스 1:1 대응 + ZK 전용 케이스 |
| 배포/상호작용 스크립트 (`scripts/`) | ✅ **preprod 배포·E2E 완료** (TournamentFinalizer `daabbf59…`, VotePointManager `350a14d9…`; grant→ZK 투표→tally→buyer→sellAggregate→sellSegment 전부 온체인 확정, `PNYX-Contract/scripts/output/preprod-run-log.md`) |
| 설계 대비 차이 | 자격 검증을 "서명 검증" 대신 **오퍼레이터가 eligibility leaf 를 온체인 삽입 → 유저가 Merkle 멤버십을 ZK 증명** 으로 구현 (Compact 에 ECDSA 없음). escrow 대상은 consent ≥ 2 (세그먼트 판매에 로우 필요), 로우 판매는 consent == 3 만. 배치 크기 8 로우/증명 |

### FE 마이그레이션 현황 (2026-08-29)

`midnight/PNYX-FE/` — PNYX-FE 를 복사해 지갑 레이어만 교체. 디자인·라우트·API 클라이언트·게임 로직 무변경.

| 항목 | 상태 |
|---|---|
| wagmi/RainbowKit/Startale → `MidnightProvider` (Lace DApp connector 4.x) | ✅ `useAccount/useChainId/useDisconnect` 어댑터(`~/hooks/wallet`)로 화면 15개 파일은 import 만 교체 |
| SIWE → Lace `signData` 로그인 (`/auth/midnight/verify`) | ✅ FE, BE 미구현 |
| `useFinalizeTournament` — grant → 브라우저 ZK 증명 → Lace 제출 → escrow | ✅ `phase` 로 "증명 생성 중" 표시, Result 에 동의 등급(1/2/3) 선택 UI |
| 컴파일 컨트랙트·zk 자산 동기화 (`pnpm sync:contract`, 유저 회로만 19MB) | ✅ |
| typecheck | ✅ 0 에러 |
| `next build` (webpack + asyncWebAssembly) | 진행 중 — §10 참고 |
| BE (`midnight/PNYX-BE`) | ✅ `/auth/midnight/verify`(Lace 서명 검증+주소 바인딩), Midnight 분기 grant(온체인 `grantEligibility`, 스모크 tx `00cb04ec…` 25초), `/midnight/finalize-confirm`(스캐너 로직 재사용), `/escrow`, chainId 99101. 단위 테스트 95/95, 부팅·시뮬레이션 Lace 로그인 검증. 미포팅: VotePointManager, `sell*` 엔드포인트 |

## 10. 미확정 / 확인 필요

- [ ] 해커톤 기한·제출 형식 (라이브 vs 영상, preprod 배포 필수 여부) → §7 역산
- [ ] 심사 기준 (기술 vs 비즈니스 비중) → §9 순서 조정
- [ ] 세그먼트 축 (ageBand·gender 외 추가?) → 기존 유저 프로필 스키마 확인
- [ ] k 값 (30 가정) 과 가격 정책
- [ ] Midnight Korea 측 제공 리소스 (멘토, faucet 한도, 호스팅 proof server 유무)

---

## 참고

- Midnight Docs — https://docs.midnight.network
- Compact 언어 소개 — https://midnight.network/blog/compact-the-smart-contract-language-of-midnight
- Compact Deep Dive — https://docs.midnight.network/blog/compact
- Midnight 메인넷 (2026-03-31 federated) — https://dev.to/midnight-aliit/midnight-mainnet-is-live-the-privacy-stack-just-got-real-4d65
- ZK Ballot Prototype (Catalyst) — https://projectcatalyst.io/funds/15/midnight-compact-dapps/midnight-zk-privacy-preserving-digital-ballot-prototype
- DAO 프라이버시 패턴 — https://dev.to/anthonym/how-midnight-brings-privacy-to-daos-3m1j
