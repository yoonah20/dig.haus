# Phase 4/5 — Nightly Local LLM Curation Pipeline (design brief)

**Status**: parked until Phase 3 (mydig) closes.
**Drafted**: 2026-04-20, with web Claude Code. Reviewed by local Claude Code same day.

This doc captures the full design brief the user drafted, plus a short "read this first" section with open questions surfaced during review. Written in Korean because the source was Korean; exception to the English-only rule for planning docs noted.

---

## Read this first (review notes, 2026-04-20)

Points to resolve **before** starting L0:

1. **동기 명문화**. 비용 절감이 아니라면 진짜 목적이 뭔지 한 줄로 고정해둘 것. 현재 후보: *"자는 동안 앨범 DB가 저절로 커지는 경험 + 놀고 있는 로컬 GPU 활용"*. 이 문장이 설계 우선순위의 기준이 됨.
2. **블라인드 벤치 범위 확장**. L0c가 excerptKo만 보는데, pickEditorialUrls·pronunciation·similarDescriptions도 로컬로 넘기는 이상 품질 체크에 포함해야 함. Haiku를 교체할 근거가 필요한 것들.
3. **Pre-L0 스팟 체크**. L0a 들어가기 전 하루 투자해서 Qwen3-14B 로컬에 띄우고 기존 앨범 3장 excerptKo 생성해보기. 결과가 기대 이하면 전체 플랜 피벗 (다른 모델? 7B + 강한 프롬프팅? 로컬 포기?). 본격 벤치 인프라 짜기 전에 감부터 잡는 용도.
4. **Idempotency 설계**. `/api/admin/apply-curation`이 mbid 기준 upsert인지 skip-if-exists인지 명시해야 함. 씨앗 (a)(유저 요청 자동 소화)를 쓰면 admin 수동 경로와 충돌 가능성.
5. **하드웨어 현실 체크**. RTX 5080 16GB면 Qwen3-14B Q5_K_M + KV cache가 거의 꽉 참. 추론 서버는 **llama.cpp 일택**으로 두는 게 맞음 (vLLM의 배칭 이점은 concurrency=1 파이프라인엔 무의미). WSL2 GPU 패스스루 + 모델 항시 로드 상태 유지 셋업 공수도 계산에 넣기.

확정 답안 (review 자리에서 정한 것):

- **씨앗 공급원**: 초기엔 **(b) csv/txt 드롭만**. (a) 유저 요청 자동 소화는 L7로 미룸 — 이중 처리·충돌 리스크를 파이프라인 안정화 후에 마주하는 게 안전.
- **로컬 전 과정 실행 + 승인분만 Railway push**: 채택. Cloudflare Tunnel 불필요, 인증 단순화.
- **컨펌 UI**: **독립 페이지 `/admin/overnight`**. 카드 단위 편집/승인이 자체 상태를 많이 가져서 Admin.tsx 탭으론 좁아짐.

---

## 배경

CLAUDE.md 외에 이전 세션에서 결정된 맥락:

**목표**: 로컬 RTX 5080 + 14B급 LLM으로 **야간 무인 앨범 큐레이션 파이프라인** 구축. 아침에 admin이 컨펌만 하면 승인분이 Railway 프로덕션 DB로 sync 되는 구조.

**동기**: 비용 절감이 주목적 아님 (현재 Haiku + DeepSeek fallback으로 이미 앨범당 ~$0.001 수준). 핵심은 **자동화 그 자체** + 놀고 있는 로컬 GPU 활용 + 자는 동안 앨범 DB가 저절로 커지는 경험.

## 하드웨어·모델 결정

- **하드웨어**: RTX 5080 (16GB VRAM) 현재 구성 유지. 5090/Mac Studio 업그레이드는 파이프라인 완성 후 병목 데이터 기반으로 재검토
- **종합 요약(summaryKo)은 Sonnet 4.5 유지** — 여러 리뷰 synthesis는 환각·일관성 리스크가 커서 로컬로 내리지 않음. 이 결정으로 로컬 LLM이 담당할 한국어 생성은 **짧은 의역·음차** 수준으로 제한됨 → 14B급으로 충분해짐
- **로컬 LLM 주 모델 후보 3파전** (블라인드 평가로 결정):
  1. **Qwen 3-14B-Instruct Q5_K_M** — 가장 유력. Qwen 3 세대 지시 따르기·JSON 안정성·한국어 품질 모두 개선
  2. **EXAONE 3.5 7.8B-Instruct Q5_K_M** — LG AI Research, 한국어 네이티브 훈련. 크기 작지만 한국어 fluency에서 깜짝 결과 가능성
  3. **Qwen 2.5-14B-Instruct Q5_K_M** — 베이스라인. Qwen3 대비 차이 체감용
- DeepSeek-R1-Distill-Qwen-14B는 평가 대상에서 제외 (reasoning chain 출력이 throughput 악영향, 한국어 fluency도 distill로 희석 우려)
- **추론 서버**: llama.cpp 또는 vLLM + OpenAI 호환 엔드포인트. Anthropic SDK 콜을 그대로 교체 가능한 어댑터 설계

## 로컬 LLM으로 넘길 Claude API 호출 지점

기존 호출 지점 매핑 (야간 파이프라인 안에서만 로컬로 라우팅, 기존 admin UI 경로는 손대지 않음):

| 지점 | 현재 모델 | 야간 파이프라인 전환 |
|---|---|---|
| `pickEditorialUrls` (URL 편집성 필터) | Haiku | 🟢 로컬 14B로 전환 |
| `generatePronunciation` (발음/의미) | Haiku | 🟢 로컬 14B로 전환 |
| `scrapeReviewFromUrl` / `extractFromManualText` → excerpt + excerptKo | DeepSeek 주력 + Haiku 폴백 | 🟡 로컬 14B로 전환 (실패 시 DeepSeek 폴백 유지) |
| `fetchSimilarAlbumDescriptions` | Haiku | 🟡 로컬 14B로 전환 |
| `generate-summary` (summaryKo) | **Sonnet 4.5** | 🔴 **유지** — 로컬로 내리지 않음 |

**중요 원칙**: 로컬 LLM 추가 ≠ Claude 호출 제거. 기존 admin-triggered UI 경로(🔎 자동 검색, 리뷰 모아오기 등)는 Claude API 그대로. 두 경로 공존.

## 파이프라인 구조

```
[ 씨앗 리스트 ] (csv/txt 드롭 — L7에서 유저 요청 통합)
   ↓
[ 앨범 자동 등록 ] ← getOrFetchAlbumBase 재활용 (MB/Last.fm/Discogs/Spotify/YT)
   ↓
[ 발음·의미 생성 ] ← 로컬 14B
   ↓
[ Serper 리뷰 URL 탐색 ] ← 확장된 단일 쿼리 (num=40, "album review" 어구 추가)
   ↓
[ URL 편집성 필터 ] ← 로컬 14B
   ↓
[ Jina 통과 → 점수·excerpt·excerptKo 추출 ] ← 로컬 14B
   (Jina 실패 시 기존 raw HTML 폴백, 그것도 실패하면 overnight 실패 로그)
   ↓
[ 종합 요약 (리뷰 2+개 있을 때, summaryKo) ] ← Sonnet 4.5 API 콜
   ↓
[ Similar 앨범 + 한국어 설명 ] ← 로컬 14B
   ↓
[ local SQLite `overnight_queue` 테이블 ]
   ↓ 💤 여기까지 야간
   ↓ 아침
[ /admin/overnight UI — 카드 한 장씩 ✅/✏️/❌ ]
   ↓
[ 승인분만 Railway 프로덕션으로 sync ]
```

## Serper 전략 — 화이트리스트 없이 페이지 확장으로 해결

메이저 리뷰 사이트 병렬 `site:` 쿼리는 Serper 호출 낭비. 구글 3페이지 안에 메이저 사이트 대부분 노출되므로 **단일 쿼리 확장**으로 대응:

```typescript
// services/serper.ts 수정 방향
// Before: `"${album}" ${artist} review`, num=20
// After:  `"${album}" ${artist} album review`, num=40
```

- "album review" 어구 추가 → 쇼핑몰·스트리밍 페이지 랭킹 내리고 편집성 사이트 상승
- num=40 → 구글 4페이지치. Serper 단일 호출 유지
- 40개 후보는 URL 편집성 필터(로컬 14B)가 솎아냄. 필터 입력 증가분 미미
- 화이트리스트 도입은 **L0 벤치 결과에 따라 재결정**. 현재 방침: 미도입

참고: 2026-04-19 커밋 `dac18b3` (Expand Serper review URL discovery to 40 results and anchor on "album review" phrase)에서 이미 부분 적용됨. Phase 4 진입 시점에 현재 상태 재확인 필요.

## Jina 실패 로깅

기존 `/api/admin/scrape-failures` 인프라 확장. overnight 전용 소스 구분:

```sql
-- 기존 테이블에 source 컬럼 추가 또는 별도 테이블
overnight_scrape_failures (
  id, url, host, album_id,
  failure_mode TEXT, -- jina_error_payload / jina_empty / raw_html_empty / timeout / other
  raw_response_preview TEXT,
  attempted_at, attempt_count
)
```

- 실패 자체는 조용히 로그만 (사용자 방침: 메이저 아닌 사이트 실패는 패스 OK)
- 2–4주치 데이터 쌓이면 패턴 분석 → Playwright 폴백 구축 여부 / 사이트별 custom reader 결정
- 메이저 사이트에서 Jina + raw HTML 둘 다 실패한 케이스는 아침 컨펌 UI에 **"수동 paste 필요"** 플래그로 표시 → 관리자가 `extractFromManualText` (Claude) 경로로 처리

## 기존 코드에서 재활용 가능한 것

구현 시 새로 짜지 말고 이것들부터 체이닝:

- `getOrFetchAlbumBase` — 앨범 등록 전 과정
- `discoverReviews`, `pickEditorialUrls` — URL 탐색·필터 (야간 버전은 쿼리·limit만 교체)
- `scrapeReviewFromUrl` (Jina + 추출) — 본문·점수·excerpt
- `fetchSimilarAlbums` + `generateSimilarDescriptions`
- `normaliseKoreanTerms`, `stripSummaryPreamble`, `generateKoreanSummary` — **로컬 LLM 출력에도 그대로 적용 필수**
- `/api/admin/scrape-failures` 인프라 — overnight 실패 로그 합치기

## 새로 만들어야 하는 것

1. **로컬 LLM 클라이언트** — `server/src/services/localLlm.ts`
   - OpenAI 호환 엔드포인트 래퍼
   - Anthropic SDK 인터페이스와 호환되는 얇은 어댑터 (기존 호출부 수정 최소화)
   - `LOCAL_LLM_BASE_URL`, `LOCAL_LLM_MODEL` 환경변수
   - 타임아웃 + 실패 시 Claude/DeepSeek API로 자동 폴백
2. **야간 러너** — `server/src/jobs/overnightCurator.ts`
   - N건씩 순차 처리 (동시성 1)
   - 단계별 에러 격리 + 상세 로그
3. **overnight 스키마**
   ```sql
   overnight_queue (
     id, seed_type TEXT, seed_payload TEXT, -- json
     status TEXT, -- pending/processing/awaiting_confirm/approved/rejected/failed
     album_id INTEGER NULL,
     pipeline_stage TEXT,
     error_log TEXT NULL,
     local_artifacts TEXT, -- json: 생성된 발음/요약/similar 등
     created_at, processed_at, confirmed_at
   )
   ```
4. **아침 컨펌 UI** — `/admin/overnight` (독립 페이지로 확정)
   - 카드 단위 ✅ 승인 / ✏️ 인라인 편집 / ❌ 폐기
   - 발음·점수·excerpt·excerptKo·summaryKo 모두 편집 가능
   - 원본 리뷰 URL 링크, "수동 paste 필요" 플래그 노출
5. **Railway sync** — 승인 시 프로덕션의 `/api/admin/apply-curation` 엔드포인트에 POST
   - admin 토큰 인증
   - 로컬 SQLite → 프로덕션 DB 직접 dump는 비권장
   - **idempotency 정책 확정 필요**: mbid 기준 upsert? skip-if-exists? (open question)

## 실행 방침 (CLAUDE.md 비용 규율 준수)

- 기존 admin UI 경로의 Claude 호출은 손대지 말 것
- `getOrFetchAlbumBase`의 "never warm-up reviews" 원칙 유지. 야간 파이프라인만 별도 경로로 리뷰 탐색
- 로컬 LLM 실패 시 Claude/DeepSeek API 자동 폴백 — 단 야간 파이프라인 안에서만. 폴백 발동 시 로그 남겨 아침 감사 가능
- 기존 Claude usage 패널과 유사한 **로컬 LLM 통계 패널** 신설: 처리 건수, 평균 지연, 폴백률

## 서브페이즈

### L0 — 사전 벤치 (본 구현 전 필수)

- **Pre-L0. Qwen3-14B 스팟 체크 (하루)** — 로컬 띄우고 기존 앨범 3장 excerptKo 생성. 품질 감 잡기. 기대 이하면 전체 플랜 피벗.

- **L0a. Serper 단일 쿼리 확장 벤치**
  - `"${album}" ${artist} album review` + num=40 구성
  - 실존 메탈 앨범 5장 (Napalm/Century Media/Season of Mist 신보 섞기)으로 돌려서 **메이저 사이트 hit 비율** 확인
  - 목표: 앨범당 편집성 리뷰 8–12개 / 그 중 메이저 5개 이상
  - 결과 미달이면 화이트리스트 도입 재검토

- **L0b. Jina 커버리지 벤치 + 실패 로깅 인프라**
  - L0a에서 얻은 URL 전부 Jina 통과
  - `scrape_failures` 테이블에 overnight 소스 구분 추가 + 실패 패턴 누적 구조 구현
  - Playwright 폴백 결정은 2–4주치 로그 수집 후

- **L0c. 한국어 excerptKo 블라인드 평가 (3파전)**
  - 프로덕션 기존 앨범 10장에서 원문 리뷰 추출
  - 3개 모델로 excerptKo 생성:
    - **Qwen 3-14B-Instruct Q5_K_M**
    - **EXAONE 3.5 7.8B-Instruct Q5_K_M**
    - **Qwen 2.5-14B-Instruct Q5_K_M** (베이스라인)
  - `/admin/bench` 페이지에서 무작위 순서로 표출, 1–5점 블라인드 평가
  - 각 모델 평균 점수 + 자주 걸리는 패턴 (직역체, 장르 용어 오역 등) 식별
  - 결과로 주 모델 확정

- **L0d. pronunciation + similar descriptions + pickEditorialUrls 스팟 체크**
  - 주 모델 확정 후 5앨범씩 샘플 생성해서 눈으로 확인
  - Haiku 교체 근거가 나오는지 검증 (원 설계는 excerptKo만 봤지만 Haiku 대체 3종 모두 체크)
  - `normaliseKoreanTerms` 패턴 확장이 필요하면 여기서 추가
  - 크게 문제 없으면 L1로 넘어감

### L1 — 인프라

- llama.cpp 로컬 서버 기동 + `localLlm.ts` 어댑터 + 환경변수 + health check
- 기존 Claude 호출 1개(`pickEditorialUrls`) 로컬 전환 가능하게 배선 (실사용은 아직 안 함)

### L2 — 스키마 + 러너 골격

- `overnight_queue` 테이블
- `overnightCurator.ts` 스켈레톤
- 수동 트리거 API (`POST /api/admin/overnight/run`) 로 앨범 1건 end-to-end 검증

### L3 — 컨펌 UI

- `/admin/overnight` 화면, 카드 렌더, 인라인 편집, ✅/❌ 액션
- "수동 paste 필요" 플래그 표시

### L4 — 씨앗 공급 (csv/txt 드롭)

- (b) 방식만 구현 + cron 등록

### L5 — Railway sync

- 프로덕션 `/api/admin/apply-curation` 엔드포인트
- 로컬 승인 시 자동 POST
- **idempotency 정책 먼저 확정 후 구현**

### L7 — 온라인 유저 요청 통합 (deferred)

**L0–L5 완료 후 로컬 파이프라인이 야간 배치에서 충분히 안정화된 것을 확인하고 나서 진행.** 현재 dig.haus 온라인 유저 앨범 등록 요청은 기존 경로(Jina + Serper + Haiku + DeepSeek + Sonnet)로 계속 처리됨.

**도입 시 아키텍처**: Push(터널) 방식이 아니라 **Pull 방식**으로 설계.

- Railway는 유저 요청을 받아서 `overnight_queue`에 `seed_type='user_request'`로 INSERT만 함 (Railway 쪽에 로컬 LLM 관련 의존성 없음, 새 외부 콜 없음)
- 로컬 워커가 주기적으로 `GET /api/admin/overnight/pending` 폴링 → 대기분 처리 → `POST /api/admin/apply-curation` 로 결과 업로드 (승인 대기 상태)
- admin이 `/admin/overnight`에서 컨펌 — 카드에 "👤 유저 요청" 마크로 배치와 구분

**Pull을 선택한 이유**:
- 로컬 PC 다운돼도 유저 요청은 Railway DB에 안전하게 쌓임 (장애 전이 없음)
- Cloudflare Tunnel 불필요 (로컬이 아웃바운드로 호출하는 구조)
- 인증 단순화 (admin API 토큰 1개)

**필요 구성요소**:
- L7a. `albumRequests.ts`에 `overnight_queue` enqueue 분기 추가
- L7b. 로컬 워커에 polling loop
- L7c. admin 컨펌 UI에 유저 요청 뱃지 + 요청자명
- L7d. heartbeat 인디케이터 (`/admin` 대시보드에 로컬 워커 online/offline 상태)

**유저 대기 기대치 관리**: 도입 시 요청 확인 문구를 "검토 후 등록됩니다" → "보통 하루 안에 처리됩니다" 정도로 조정. 로컬 장기 오프라인 시 폴백은 **기본값 '그냥 기다림'** (프로젝트 톤에 맞게 보수적).

## 사용 예시 — Napalm Records 2025년 발매작 배치 작업

### 1. 씨앗 투입 (저녁, 자기 전)

```csv
artist,title,release_year,label
Battle Beast,Steelbound,2025,Napalm Records
Stratovarius,Demand,2025,Napalm Records
Grave Digger,Bone Collector,2025,Napalm Records
Ensiferum,Winter Storm,2025,Napalm Records
Eluveitie,Ànv,2025,Napalm Records
...
(Napalm 2025 디스코그래피에서 ~25장)
```

`/admin/overnight` "씨앗 드롭" 영역에 csv 업로드 → `overnight_queue`에 25행 생성, 전부 `status=pending`, `seed_type=csv_batch`.

### 2. 야간 러너 기동 (예: 23:00)

```
[1/25] Battle Beast — Steelbound
  ├─ 앨범 등록: getOrFetchAlbumBase                                              OK (12s)
  ├─ 발음/의미: 로컬 14B                                                         OK (2s)
  ├─ Serper: "Steelbound" Battle Beast album review (num=40)                     OK 38 URLs
  ├─ URL 편집성 필터: 로컬 14B → 8개 채택                                        OK (3s)
  ├─ Jina 통과 + excerptKo: 로컬 14B × 8                                         OK 7개, 1개 Cloudflare (로그)
  ├─ 종합 요약 (7개 리뷰 → summaryKo): Sonnet 4.5 API                            OK (8s)
  └─ Similar 앨범 + 설명: 로컬 14B                                               OK (8s)
  → status=awaiting_confirm, 총 소요 ~1분

[2/25] Stratovarius — Demand
  ...
```

25장 × 평균 1–2분 = **약 30–50분**. 새벽 1시경 마무리.

### 3. 아침 컨펌

```
┌─────────────────────────────────────────────┐
│ [cover] Battle Beast — Steelbound  (2025)   │
│         베틀 비스트 — 스틸바운드              │
│         "강철에 묶이다"                       │
│                                              │
│ 리뷰 7개 수집 (Jina 실패 1: Cloudflare)     │
│ 평균 7.8/10                                  │
│                                              │
│ 종합 요약 (한국어, Sonnet):                  │
│ "핀란드 심포닉 파워 메탈의 최신작으로..."     │
│                                              │
│ Similar: Nightwish, Beast in Black,         │
│          Amaranthe, Battle Beast 전작...    │
│                                              │
│   [✅ 승인]  [✏️ 편집]  [❌ 폐기]             │
└─────────────────────────────────────────────┘
```

25장 × 10–20초 = **10분 내 컨펌 완료**.

### 4. Railway sync

승인 누르는 순간 백그라운드로:

```
POST https://dig.haus/api/admin/apply-curation
  Authorization: Bearer <admin-token>
  Body: {
    album: { mbid, artist, title, pronunciationKo, meaningKo, ... },
    reviews: [ {source, url, score, excerpt, excerptKo}, ... ],
    summary: { summaryKo },
    similar: [ {mbid, descriptionKo}, ... ]
  }
```

### 결과

- 수면 1시간 GPU 가동 → 25장 큐레이션
- 관리자 실질 노동: csv 만들기 10분 + 아침 컨펌 10분 = **하루 20분 투자로 25장**
- 기존 admin UI 수동 경로 대비 10–20배 처리량
- Claude API 비용: summaryKo (25 × ~$0.01) + 폴백 ≈ **$0.30–0.50 / 배치** (무시 가능)

## 재개 시 첫 동작

Phase 3 (mydig) 닫고 이 문서로 돌아오면:

1. 위 "Read this first" 5가지 open question을 현재 시점 기준으로 다시 훑는다 (특히 3, 4, 5번 — 하드웨어 / 벤치 범위 / idempotency)
2. `dac18b3` 이후 Serper·Jina·DeepSeek 경로가 얼마나 변했는지 `git log` 확인
3. Pre-L0 스팟 체크부터 시작
