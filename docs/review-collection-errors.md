# review collection — running error log

Append-only log of score / extraction bugs spotted on real album pages. Each entry: source URL, expected vs observed, root cause, fix status.

The point: keep the small "여전히 자잘한 오류" surfaced as concrete cases so detectors don't drift back into hand-wavy regression.

Add new entries to the top.

---

## 2026-05-18 — metalexpressradio.com user-rating 위젯이 항상 0점으로 잡힘

- **URL**: https://www.metalexpressradio.com/2003/09/08/dimmu-borgir-death-cult-armageddon/ (+ 기존 DB에 같은 패턴 2건: house-of-lords/world-upside-down, starbreaker/starbreaker)
- **Expected**: `null` (editor가 점수를 채우지 않은 wp-review 페이지)
- **Observed**: `0/100`
- **Cause**: MER 페이지는 wp-review 플러그인을 쓰는데 editor가 점수 widget을 빈 채로 두면 (`data-originalrating="0.0"` + `<div class="review-result" style="width:0%">`) `detectWpReviewPluginRating` 가 가드로 정확히 null 반환. 다음 detector로 fall-through — `detectExplicitNumericScore` 의 rule 5 (bare fraction LAST match) 가 페이지 끝의 user-rating widget 텍스트 `<span class="review-total-box"> <span ...>0/10</span> <small>(0 votes)</small></span>` 를 stripHtml 한 결과 `0/10 ( 0 votes)` 의 `0/10` 을 잡아서 **0점** 반환. 페이지 사이드바에 다른 앨범의 실제 editorial score (e.g. 8.2/10) 가 있어도 마찬가지로 오염될 수 있음 — last-match 휴리스틱이 사이드바 / 위젯 contamination에 취약.
- **Fix**: `detectExplicitNumericScore` rule 5 시작 부분에 두 단계 가드 — (a) raw HTML 에 `wp-review-user-rating` / `data-originalrating=` markup 이 있으면 rule 5 skip 후 null 반환 (rules 1–4 의 labelled score 매치는 그 전에 이미 return 되므로 영향 없음); (b) 그게 없는 페이지에서도 bare-fraction 매치 뒤 40 chars 안에 `vote(s)` 단어가 따라오면 그 매치는 skip. 6개 synthetic 케이스 (editorial sign-off / 사인오프 + user widget / data-originalrating 단독 / wp-review 없음 + sign-off / 위젯 없는 stray votes / labelled 우선) + 실제 MER 페이지 → 전부 expect 와 일치. 기존 DB 의 0-score MER row 2건은 코드 fix 만 적용 (재수집 시 자동으로 null 로 정정됨).
- **Status**: fixed

---

## 2026-05-18 — vm-underground /band/<slug>/ archive 페이지가 등록됨

- **URL**: https://www.vm-underground.com/band/ebony-tears/
- **Expected**: 거부 (`not-a-review-in-prose`). 페이지는 "Ebony Tears Archives" — band tag archive 로 사이트 전체 최근 리뷰 링크만 나열할 뿐 해당 앨범 본문 없음.
- **Observed**: 등록됨. score=null, excerpt_ko = "이 페이지는 앨범 제목과 리뷰 링크만 제공한다. 리뷰 본문이나 평점은 확인할 수 없다."
- **Cause**: (1) 링크-only 룰 `(?:리뷰|평론)\s*링크만?\s*(?:포함|수록|있|싣|모아)` 의 동사 목록에 `제공` 이 빠져 있어서 "리뷰 링크만 **제공**한다" 가 빠져나옴. (2) 아카이브 룰 subject set `(태그|작가|저자|카테고리|아티스트)` / `(tag|author|category|artist) archive` 에 `밴드/band` 가 없어서 LLM이 `밴드 아카이브` 라고 말해도 안 잡힘. URL 구조 (`/band/<slug>/`) 자체가 이 카테고리.
- **Fix**: 링크-only 룰에 `제공` / `제시` 추가. 아카이브 룰 subject 에 `밴드` / `band` 추가. 15개 케이스 (사용자 보고문구 + 밴드-아카이브 KR/EN + 기존 링크-list/lambgoat reject + 진짜 lambgoat 리뷰 4개 + edge case 4개) 모두 통과.
- **Status**: fixed

---

## 2026-05-18 — lambgoat /albums/<id>/ "Our score: N/A" 페이지가 placeholder 본문으로 등록됨

- **URL**: https://lambgoat.com/albums/1050/subzero-happiness-without-peace-re-release/
- **Expected**: 거부 (`not-a-review-in-prose`). 페이지는 메타데이터(연도/레이블)만 있고 리뷰 본문 자체가 없음. "Our score: N/A".
- **Observed**: 등록됨. score=null, excerpt_ko = "이 앨범에 대한 평점은 제공되지 않는다."
- **Cause**: `services/reviews.ts` 의 prose-rejection 패턴이 이미 "score-only meta-commentary" 케이스를 잡고 있고, 코멘트도 lambgoat 페이지를 명시적으로 노리고 있었음. 하지만 이번 문구는 두 가지 이유로 빠져나옴 — (1) 주어가 `이 앨범에` 인데 기존 룰은 `이 페이지/글/기사/리뷰/텍스트` 만 매칭, (2) 부정어가 `제공되지 않` 인데 기존 룰의 부정어 목록 (`없/부재/존재하지 않/찾을 수 없/기재되지 않/표시되지 않/확인되지 않`) 에는 `제공/부여/명시되지 않` 이 빠져 있었음.
- **Fix**: 두 변형을 잡는 KR 패턴 1개 + 영문 변형 2개 추가. 14개 케이스 (placeholder 7개 reject + 진짜 Lambgoat NULL-score 리뷰 4개 keep + edge cases 3개 keep) 모두 통과.
- **Status**: fixed

---

## 2026-05-18 — thedarkmelody.com WP Review 총점 무시

- **URL**: https://thedarkmelody.com/review-clasico-seventh-wonder-tiara-2018/
- **Expected**: `91/100` (페이지 본문에 `9.1/10` 총점이 별도 단으로 명시)
- **Observed**: ~`50/100` (사용자 보고 — DB row 이미 삭제, 정확값 미확인)
- **Cause**: 페이지가 MyThemeShop *wp-review* 플러그인을 쓰는데, sub-rating 4개를 `<div class="review-result" style="width:N%">` 으로 깔고 (90 / 86 / 92 / 95 — Production / Composition / Replay / Personal) 그 아래 별도로 `<span class="review-total-box">9.1/10</span>` 으로 총점을 렌더링한다. `detectWpReviewPluginRating` 는 첫 번째 `review-result` width 만 잡아 **첫 sub-rating** (= Production 9/10 = 90) 을 반환했고, 총점 9.1 은 무시됐다. (사용자 기억의 "50점" 은 별개 — 이 페이지에서 50이 나올 경로는 코드상 보이지 않음. 다른 URL과 섞였거나 옛 코드 경로일 가능성.)
- **Fix**: `detectWpReviewPluginRating` 에 `review-total-box` / `review-total` 노드 텍스트의 `N(.N)?/(5|10|100)` 을 먼저 시도하는 분기 추가. 매칭 시 sub-rating widget 으로 fall-back 하기 전에 그 값을 우선 반환.
- **Status**: fixed
