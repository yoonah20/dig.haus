# review collection — running error log

Append-only log of score / extraction bugs spotted on real album pages. Each entry: source URL, expected vs observed, root cause, fix status.

The point: keep the small "여전히 자잘한 오류" surfaced as concrete cases so detectors don't drift back into hand-wavy regression.

Add new entries to the top.

---

## 2026-05-18 — thedarkmelody.com WP Review 총점 무시

- **URL**: https://thedarkmelody.com/review-clasico-seventh-wonder-tiara-2018/
- **Expected**: `91/100` (페이지 본문에 `9.1/10` 총점이 별도 단으로 명시)
- **Observed**: ~`50/100` (사용자 보고 — DB row 이미 삭제, 정확값 미확인)
- **Cause**: 페이지가 MyThemeShop *wp-review* 플러그인을 쓰는데, sub-rating 4개를 `<div class="review-result" style="width:N%">` 으로 깔고 (90 / 86 / 92 / 95 — Production / Composition / Replay / Personal) 그 아래 별도로 `<span class="review-total-box">9.1/10</span>` 으로 총점을 렌더링한다. `detectWpReviewPluginRating` 는 첫 번째 `review-result` width 만 잡아 **첫 sub-rating** (= Production 9/10 = 90) 을 반환했고, 총점 9.1 은 무시됐다. (사용자 기억의 "50점" 은 별개 — 이 페이지에서 50이 나올 경로는 코드상 보이지 않음. 다른 URL과 섞였거나 옛 코드 경로일 가능성.)
- **Fix**: `detectWpReviewPluginRating` 에 `review-total-box` / `review-total` 노드 텍스트의 `N(.N)?/(5|10|100)` 을 먼저 시도하는 분기 추가. 매칭 시 sub-rating widget 으로 fall-back 하기 전에 그 값을 우선 반환.
- **Status**: fixed
