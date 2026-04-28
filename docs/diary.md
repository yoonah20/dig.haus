# dig.haus 개발 일지

2026년 4월 14일 ~ 29일. 본업 끝나고 매일 밤 컴퓨터 앞에 앉아서 만든
사이트 만들기 일기. 미래의 내가 잊을까봐.

---

## 4월 14일 (화) — Day 0

claude.ai에 새 대화창을 켰다. 제목 짓는 게 어색해서 그냥 시작했다.
"베테랑 앱 개발 프로젝트 매니저이자 기획자가 되어 달라"고 첫 줄을
박았다. 처음엔 vinyl 최저가 비교 앱을 만들고 싶다고 했다. ebay나
discogs는 빼고, 진짜 매장 가격을 모아서 운송비까지 계산해주는 그런
것. 클로드가 엄청 솔직하게 잘라줬다. ToS가 막고, Cloudflare가 막고,
운송비 데이터는 체크아웃 직전에만 노출되고, CamelCamelCamel은 API가
없다고. "삽으로 바위 캐기" 같은 표현을 썼다. Discogs API + 제한적
스토어 5~10개 쪽으로 좁혀줬는데, 거기서 일단 멈췄다.

두 번째 시도는 리뷰 모음 + 한국어 요약. 이건 "흙 캐기 수준"이라고.
대형 사이트(Pitchfork, Metacritic, AllMusic, RYM)랑 Discogs 가격
같이 보여주는. Archspire의 *Too Fast to Die* 발매 3일 만에 검색해
봤더니 14개 사이트에서 리뷰가 떴다. Angry Metal Guy, MetalStorm,
Heavy Blog, Nine Circles 등등. "메탈 장르는 전용 리뷰 생태계가 매우
활성화돼있다"는 클로드 평이 마음에 들었다. 이쪽으로 가야겠다 싶었다.

그러다가 내가 vinyl 15,000장 컬렉터라는 걸 흘렸다. 클로드가 즉시
방향을 다시 짰다 — "이건 단순 정보 사이트가 아니라 본인의 디깅
워크플로우를 그대로 웹앱으로 만드는 것"이라고. 맞는 말이었다. 내가
sputnikmusic이나 RYM에서 앨범 발견하고 → 리뷰랑 vinyl 가격 확인 →
들어보고 마음에 들면 비슷한 아티스트로 디깅 이어가고 → vinyl 구매처
가 여러 곳이면 수동으로 팔로우하던 그 흐름. 이걸 한 페이지에 다
올리는 사이트.

3-phase 플랜이 잡혔다. Phase 1 정보 허브 (앨범 검색 + 리뷰 한국어
요약 + 듣기 + 구매 + 비슷한 앨범), Phase 2 개인화 (위시리스트,
컬렉션, 저장된 구매처, "찾고 있어요"), Phase 3 커뮤니티 (디깅 일기,
추천 upvote, 앨범 DNA 마인드맵). 16일 뒤에 어디까지 갈지 모르겠지만
일단 1단계부터 본격 만들어보기로.

이름도 정했다. 처음엔 The Dig가 깔끔해서 좋았는데, Deepcuts 쪽이
컬렉터 감성에 가까웠다. 다만 "비주류 뉘앙스"가 너무 강해서 메인스
트림도 다루는 우리한테는 안 맞았고. Diglog → Dighaus → 결국
**Diggershaus**. "디거들의 집"이라는 의미가 마음에 들었다. 도메인은
.com 대신 짧게 dig.haus가 더 좋을 것 같아서 Cloudflare에서 그쪽으로
샀다.

마지막으로 클로드가 1단계용 프롬프트를 길게 짜줬다 (스택, 스키마,
API 라우트, 디렉토리 구조 다 포함). 그걸 들고 Claude Code 웹 버전에
들어가서 한 번 돌려봤다. 첫 결과물이 떴다 — 앨범 그리드, 앨범 상세
페이지, Vite + Express + better-sqlite3 스캐폴드까지 한 번에. 아직
git에는 안 올렸다. 내일 로컬 + Railway로 옮겨볼 생각이다.

오늘은 코드는 거의 안 짰는데 결정이 진짜 많이 됐다. 도메인까지 산 거
는 무모할 수도 있는데, 일단 내가 결국 만들 거라는 confidence가 들어
서. 잠 들기 전에 dig.haus 검색해서 빈 페이지 한 번 새로고침 해봤다.
좀 신기했다.

---

## 4월 15일 (수) — Day 1

본업 끝나고 7시쯤 자리에 앉았다. 어제 Claude Code 웹에서 뽑은 코드를
로컬로 옮기고 git init. 처음엔 `pre-dig-mode checkpoint` 같은 안전망
commit을 세 개 박아두고, 드디어 `dig.haus initial commit`. Vite 빌드
가 한 번에 안 떨어져서 `@types/node` 추가했고, Railway 배포에서 두 번
삐끗했다 (`railway fix`, `railway 2`). `auth and cors` 한 번 더 잡고
나서야 라이브 URL이 떴다. 도메인 연결은 아직 안 했지만 Railway가 주는
임시 URL로 일단 들어가졌다.

그 후로는 album card 다듬기. vinyl이 hover에 spin하는 애니메이션을
넣어봤는데 시선을 너무 잡아끌어서 결국 release-phase로 gate를 걸어서
prerelease만 spin하게 했다. tilt 효과도 처음엔 멋있어 보였는데 옆에
카드들이랑 어긋나 보여서 결국 빼버렸다. 만들었다 빼는 걸 반복하는데,
이게 의외로 빠르게 굳어진다는 게 좋다.

cover art proxy를 만든 건 잘한 결정 같다 — 외부 이미지 호스트가
깨졌을 때 `/api/cover`에서 캐시로 fallback. 한 번 짜두면 안 신경 써도
되는 부분이라.

가격 스티커가 진짜 까다로웠다. 빨간 줄이 처음엔 너무 두꺼워서 얇게,
그 다음엔 inset 1px 추가, 그 다음엔 폰트를 Courier로 되돌리고, 노치
크기 조정, 패딩 조정. iteration 번호를 commit message에 #1부터 #11
까지 박아뒀다. 좀 강박 같지만 나중에 보면 도움 될 듯.

privacy / terms 페이지는 후딱 만들고 footer에 링크만. OAuth 붙일 때
필요하다고 들어서. 두 페이지 만드는 데 commit 두 개 — `add privacy
policy`, `terms`. 텍스트는 일반적인 boilerplate에 dig.haus 이름만
박았다.

마지막에 cover-art-archive에서 가끔 막히는 게 있어서 `force IPv4 +
front-1200` 같은 server-side 처리를 추가. CAA 소스를 250px → 1200px로
업그레이드하니까 sharper. 새벽 4시쯤 마무리. 본업 9시 출근인데 좀
무리다. 내일은 SEO 메타 잡아볼 생각이다 — OG 태그, sitemap.

55 commit. 첫날치고는 후련하다.

---

## 4월 16일 (목) — Day 2

오늘은 하루 종일 쉬지 않고 친 것 같다. 71 commit. 본업 시간 빼고
거의 다 코딩.

먼저 SEO 작업. 어제 못 한 거 차곡차곡 — OG + Twitter 메타, robots.txt,
sitemap.xml 동적 생성, per-album OG는 Vercel Edge Middleware로 (서버
사이드에서 SSR 안 해도 검색엔진/SNS 미리보기에 album cover + title이
뜨게). useDocumentHead 훅도 만들어서 라우트 별로 title + meta가 맞게
바뀌게. JSON-LD MusicAlbum payload까지 album 페이지에 박았다. 이거
다 한 번 짜두면 신경 끄는 거라 빨리 해두는 게 맞다.

Discogs 시세 가져오는 부분이 가끔 0개 떨어지는 걸 발견. q= fallback을
추가해서 release_title=가 stylized title (예: 대문자 + 특수문자) 에
실패하면 free-text q= 로 다시 시도하게. rate limit도 너무 빠르게 부르
면 막혀서 약간 throttle. Vinyl/CD 가격이 그제서야 제대로 떨어지는 걸
보고 한참 멍 때렸다.

오늘의 큰 거: **50자 평**. 처음엔 100자 평으로 시작했는데, 길이 제한
이 길수록 사용자가 부담을 가진다. 50자 한 줄이면 책임감 없이 짧은
인상 한 줄 남기고 갈 수 있다. emoji 팔레트 10개 (😊 🤔 😴 🥺 🤘 💯 ...)
+ 굿굿/별루 thumbs 강제. 평을 쓰면 자연스럽게 그 album에 vote도 같이
박히게. UI는 speech-bubble 카루셀로. 앨범 페이지에 가로로 흘러가는
말풍선들. 좀 귀여워졌다.

Discogs master 핀 기능. 같은 앨범의 reissue가 너무 많을 때 admin이
"이게 진짜 master다"라고 핀해두는 — 잘못 매칭되는 케이스 줄여줌.
register modal에서 비슷한 앨범 제안할 때 master ID를 release ID로
오인하던 버그도 같이 잡았다.

home 그리드: hover하면 album cover에 review score 따른 amber glow가
뜨게. 점수 높을수록 따뜻하게. 대놓고는 안 보이는데 자세히 보면 알게
되는 디테일.

새벽 5시. 본업 출근 4시간 남았다. 내일은 admin 페이지 정돈해보자 —
3-column 레이아웃이 시원할 것 같다.

---

## 4월 17일 (금) — Day 3

42 commit. 좀 줄였지만 그래도 빡셌다.

admin 페이지 reorganize. 3-column 레이아웃 + hover users list + 다크
스크롤바. 운영하면서 매일 들여다볼 화면이라 신중하게. album 페이지
도 max-width 좁히고 prev/next 네비게이션 박았다 (예전 디스코그래피
컴포넌트는 안 쓰는 거라 같이 제거).

오늘 가장 만족스러운 거: **굿굿/별루 split-pill**. 두 색 (파랑/빨강)
나뉜 알약 형태. 샀음/살거 ownership pill도 같은 모양으로 — 디자인
일관성을 위해. 어제 만든 50자 평이랑도 자연스럽게 묶임 (평 쓸 때
자동으로 굿굿/별루 박힘). admin top-stats도 "전체 / 오늘"로 그룹화.

정말 큰 거 두 개 더:

1. **앨범 등록 split.** 사용자가 앨범 등록 신청 → admin이 review
크롤 승인. dim 카드로 표시되고 placeholder 리뷰 박힘. 5분 단위로 admin
한테 알림 메일 나가는 디지스트도 같이.

2. **샀음 / 살거 ownership.** Vinyl / CD / Cassette 포맷별로 따로
체크 가능. 두 개 mutually exclusive (샀음 = 갖고 있음, 살거 = 갖고
싶음). 현실적으로 같은 앨범을 vinyl로는 갖고 있는데 CD는 살거 할 수
있어서. 처음엔 단일 토글이었는데 split-pill로 통일하니까 깔끔.

NEW! sticker (30일 이내), HOT! sticker (top-10 upvotes, ≥3 floor)도
오늘 박았다. record shop 분위기 살려야 한다 — 가격 스티커 옆에 빨강/
주황 라벨이 옹기종기 붙어있는 그림.

PD 본업 누적된 게 있어서 그런가, 오늘 일을 마무리하면서 "내가 만든
화면 돌리는 게 편집실에서 컷 만져보는 거랑 닮았네" 하는 생각이 들었
다. 한 화면, 한 인터랙션, 한 마이크로 디테일을 계속 다듬는 거. PD
로 일하면서 이 근육은 17년 갈고닦은 거라 익숙한 작업이다.

---

## 4월 18일 (토) — Day 4

오늘 **레코드 스토어 데이.** 매장 돌아다니면서 vinyl 사느라 종일 밖에
있었다. dig.haus 만들고 있는 와중에 정작 본인이 RSD 가는 게 좀
웃겼다 — 결국 이 사이트가 *내가 매장 다녀와서 검색해보는 그 흐름*을
재현하는 거니까. 새로 뽑아온 음반들 dig.haus에서 검색해보면서 들어
오는 데 한참 걸렸다.

밤늦게 자리 앉아서 16 commit 정도 박았다. 페이스가 늦은 게 아니라
시간이 부족했던 거.

review section pending slot — admin이 아직 크롤 안 한 album에 들어
가면 "곧 채워질 거예요" placeholder가 뜨게. 빈 화면보다 친절. summary
regenerate 버튼도 admin용으로. 한 번 생성된 한국어 요약이 마음에 안
들면 다시. cost는 캐싱 때문에 처음 한 번만 청구되고 그 이후는 무료.

cover sticker 팔레트 정비. NEW (sky 파랑, #5aa9e6) / HOT (red, #e84a3b)
/ PRE-ORDER (green, multi-line) / SALE (yellow) / SOLD OUT (orange,
multi-line). 위에서부터 NEW → HOT → PRE-ORDER → SALE → SOLD OUT 순으
로 쌓이게. 한 album에 여러 sticker 붙는 게 가능하니까 stacking 순서가
중요하다. 작은 디테일인데 record shop 가서 보면 진짜 이렇게 붙어있다.

자정쯤 큰 거 하나. **CLAUDE.md 시작했다.** 매번 새 Claude 세션 들어
오는 사람한테 "이 프로젝트는 이런 거고, 지금까지 이런 결정을 해왔다"
는 컨텍스트를 한 페이지로 요약. 회의실에서 신입 PD 들어왔을 때 "지금
까지 이런 톤으로 가고 있다"고 알려주는 거랑 비슷. 매번 처음부터 설명
하는 게 비효율적이고 아이디어가 흩어진다. 이거 한 장이면 다음 세션
도 같은 결로 작업 가능.

snapshot-dump 엔드포인트도 만들었다 — DB + uploaded assets (avatars,
custom-covers) 한 tarball로. local로 끌어와서 sanitize한 다음 디버깅
할 때 쓰려고.

새벽 2시쯤 마무리. 토요일치곤 그래도 쉰 셈.

---

## 4월 19일 (일) — Day 5

26 commit. 일요일 오후부터 시작.

오늘은 phase 2 closeout이었다. "phase 2 final" + "phase 2 polish"
두 commit으로 정리. 무엇이 phase 1이고 무엇이 phase 2였는지는 사실
계속 흐릿했는데, 굳이 깊이 정리는 안 했다. 동작하면 됐고.

큰 변화 두 개:

1. **Tagline 바꿨다.** 처음엔 "dig by cover, find by feel" 같은
   *방법*에 집중하는 카피였는데, 마음에 안 들어서 "No algorithms
   needed. Just digging."으로 바꿨다가 다시 "Keep digging."으로.
   directive 쪽이 read하기에 더 자연스러운 듯. anti-algorithm 정체
   성을 헤더에 박아두는 게 나중에 feature creep 방지될 거 같다.

2. **리뷰 파이프라인 대대적 변경.** 어제까지 Claude의 web_search로
   리뷰 긁어왔는데, 이게 한 호출에 수만 토큰 input으로 끌어들이고
   인기 사이트는 매번 다시 긁어 비용이 미친 듯이 빠진다. 한 세션에
   10개 album에 $5 나온 거 보고 결단 — album 하나에 약 $0.50.
   **web_search path 완전 제거.** 대신 Serper.dev (구글 검색 결과
   JSON, $0.0003/call) + Jina Reader (HTML → markdown, 무료) +
   Haiku로 editorial URL 필터. 사이트별 점수 detector도 같이 짰다 —
   schema.org rating, star widget, filename image, 숫자 등등. 이렇게
   분리하니까 album 하나에 리뷰 15개 정도 수집해도 **$0.01 수준.
   30~50배 절감.** 새 파이프라인 첫 시험 돌리고 비용 확인했을 때
   숫자가 너무 작아서 한참 다시 봤다.

scrape-failure log도 만들었다. 어떤 호스트에서 scrape이 실패하는지
admin 페이지에서 보고 blacklist 처리할 수 있게. 수동 retry도 가능하게
.

label-tracking feed도 시도. Spotify에서 특정 레이블의 신보를 자동
풀링해서 admin이 pick-to-register. 컬렉터 입장에서 "내가 좋아하는
레이블 신보"는 정말 유용한 채널이라.

새벽 3시. 일요일이라 그래도 5시간 정도는 쉬었다.

---

## 4월 20일 (월) — Day 6

33 commit. 본업 시작하는 월요일이라 평일 페이스로 돌아왔다.

리뷰 픽업 정확도가 조금씩 어긋나는 걸 잡았다. Jina가 가끔 error
payload를 정상 응답처럼 돌려주는 케이스 발견 — 이걸 detect하는 가드
추가. Claude prompt도 살짝 loosen해서 너무 strict하게 무시되는 케이스
줄였다. manual retry from failure log + source name history도 같이.

오늘부터 Phase 3 시작. **mydig 스키마 깔았다.** users.username (URL-
safe slug) 추가, /my/:username 라우트 placeholder. username onboarding
modal 만들고 TopNav에 "내 가게" 진입점 박았다. admin CRUD for Shelf
genre taxonomy도 같이 (16개 장르 시드).

phase 3b: **Vinyl Wall edit mode + drag-drop + candidate picker.**
원래 사용자 페이지 컨셉은 "내가 좋아하는 vinyl을 벽에 걸어두는" 거.
22장 슬롯에 drag-drop으로 배치하고 candidate picker (전체 / 샀음 /
굿굿 / 살거)에서 검색해서 끌어다 놓는다. 이게 핵심 기능이다. 처음
짠 게 동작하긴 하는데, drag-drop이 모바일이랑 약간 어색해서 내일 한
번 더 봐야 할 듯.

D-N countdown chip — 발매 안 된 album에 "D-7" 식으로 카운트다운 띄우게.
PRE-ORDER cover sticker는 이걸로 대체했다 (sticker는 sold out 같은
"지금 상태"에 더 어울리고, countdown은 "기다림"의 다른 무드).

dev: Vite + Express 둘 다 0.0.0.0에 바인드. WSL2에서 Windows 브라우저
로 localhost 접근 안 되는 문제 잡으려고. 좀 헤맸다.

DeepSeek primary + Haiku fallback on scrape extraction. shadow LLM
router를 통해 시험해보고, 비용 낮은 모델로 갈 수 있는 부분은 갈고
싶다. 지금까지 Claude만 쓰던 거에 옵션 추가.

새벽 4시. 점점 익숙해지지만 누적은 쌓인다.

---

## 4월 21일 (화) — Day 7

50 commit. 오늘 진짜 큰 작업 두 개 했다.

**1. 큐레이션 파이프라인 one-click batch.**

지금까지는 admin이 album 하나씩 들어가서 "🔎 자동 검색" 누르고 결과
보고 또 누르고… 100개 album 쌓이면 손이 모자라. 그래서 album들에
체크박스 붙이고, 글로벌 progress panel 띄워서 한 번에 batch 돌리는
구조 만들었다. 백그라운드에서 album by album 순서대로 discover →
scrape → summary 진행하고, panel에서 진행률 실시간 표시. failure
slot은 backfill하고, summary는 transient error에 retry.

가장 만족스러운 건 chunk-size dynamic adjustment. 한 album에 15
URL까지만 저장하게 cap을 걸었는데, 앞 chunk에서 5개 통과하면 다음
chunk는 10개 시도, 또 5개 더 통과하면 5개 시도 — 이렇게 점차 줄여서
정확히 15개에 멈추게. 이거 쥐어짜듯 짠 거라 commit message가
"strict 15-save cap via dynamic chunk sizing"이라고 박혀있다. 좀
뿌듯하다.

**2. 사이트별 점수 detector 정밀화.**

각 메탈 사이트가 점수를 표기하는 방식이 다 다르다. Sputnikmusic은
별점 + 100점 환산, Metal Trenches는 X/10 텍스트, AMG는 "AMG Score:
4.0/5.0", muchmetal은 "Score of X" — 이런 식. 사이트별 detector를
하나씩 박았다. 그리고 ranking listicle / interview / press release
URL은 prompt + 정규식 둘 다로 미리 거른다.

bot-wall blacklist도 6개 host 추가. 자꾸 "페이지 로드 실패" 에러
내뱉던 site들. rockhard.de는 paywall이라 따로. 아예 진입 단계에서
배제.

LLM router도 env-driven으로 만들었다. 각 operation마다 primary +
shadow 모델을 .env에서 정할 수 있게. shadow는 비교용이고 primary가
실제 응답. /admin/compare 페이지에서 같은 prompt에 대해 Haiku vs
DeepSeek vs Sonnet 결과 나란히 띄워서 quality 비교 가능.

오늘 변경한 것들이 16개 album에 다 적용돼서 backlog가 한 번에 깔끔
해졌다. 한 시간에 자동으로 다 처리되는 걸 보면서 조용히 한참 멍 때렸
다. 이런 작업이 재밌어서 본업 끝나고 자리 앉으면 시간이 안 가.

새벽 5시.

---

## 4월 22일 (수) — Day 8

50 commit. 오늘은 mydig storefront pivot 날.

어제까지 mydig wall은 그냥 grid + 그림자였는데, 좀 더 *공간감*을
주고 싶었다. 처음엔 "Hongdae-dusk 레코드샵 인테리어"로 잡았다 — 보
라/다크플럼 분위기. 한 시간 정도 깔아봤는데, 너무 *진지한* 느낌. 컬
렉터들이 "내 vinyl을 늘어놓는" 즐거움이 안 느껴졌다.

그래서 **lofi-bedroom**으로 swap. 카페 셔틀톡 같은 채도 낮은 일러스트
공간. 내 방에 vinyl 늘어놓는 느낌. 이게 훨씬 dig.haus다웠다. 결정 후
phase 3 decisions log를 만들고 거기에 "왜 그렇게 갈았는지" 박았다.
다음에 또 흔들릴 때 거기 보면 된다.

mydig 라우트가 :username과 candidates picker가 충돌해서 candidates 못
가져오던 버그 잡았다. wall layout도 hardening — LP 위치 randomization
이 reload할 때마다 바뀌는 걸 deterministic으로 (mbid hash 기반).

cover에 native img drag가 있어서 VinylWall drag-drop이 가끔 hijack
당하는 걸 잡았다. 작은데 큰 영향.

home grid 3-step density slider. comfortable / dense / ultra. 사용
자가 한 번에 몇 장씩 보고 싶은지 정할 수 있게. ultra는 한 줄에 10장
까지. 컬렉터들은 ultra를 좋아할 것 같다. price tag도 카드 사이즈에
따라 자동 스케일.

source trust panel을 admin에 추가했다. host별 success / failure 이력
+ whitelisted (curation 우선순위 부여) + blacklisted (절대 제외). 코드
에 박혀있던 EXCLUDED_URL_DOMAINS 일부를 DB로 옮기기 시작. 운영 결정
이라 코드 deploy 없이 admin이 갈 수 있어야.

prompt에 EPK / out-now news slug / interview 잡는 layer 5개 더 박
았다. 어쩌면 이거 너무 많은가 싶기도 한데, 잘못된 URL 한 번 통과하면
$0.001 + Claude 시간 다 낭비라 미리 거르는 게 낫다.

새벽 4시. 내일은 mydig wall 비주얼 더 다듬을 예정.

---

## 4월 23일 (목) — Day 9

40 commit. mydig 비주얼 작업 거의 하루 종일.

phase 3 decisions log에 1/2 + 16-17 + 18-19 + 20번까지 entry 추가.
storefront 방향이 자꾸 흔들렸다. CSS만으로 lofi-bedroom 무드 만드는
거 vs 일러스트 asset 사놓고 그 위에 oversized DOM 얹는 거 (Path A
vs Path B). 결국 wireframe 우선으로 가기로 했다 (entry 19). 일러스트
asset은 나중. 첫 발에 모든 디테일을 박지 말자.

wall slot 수도 흔들렸다. 처음 22장 → 5×2 = 10장으로 trim → 다시
5×3 = 15장. 22장은 컬렉터한테 너무 적었고, 10장은 너무 압축돼서
"내가 좋아하는 거 다 못 넣겠다"는 느낌. 15장이 sweet spot. 5×3 grid
면 라인 별로 wood rail이 들어가서 시각적으로도 좋다.

**Vinyl Wall snapshots**도 오늘 처음 만들었다. wall 상태를 이름 지어
보관하고 (예: "2026 4월 추천", "겨울 mood"), public/private 토글.
URL share도 가능 (/my/:u/snap/:slug). snapshot은 만들어진 후엔
immutable — 그 시점의 큐레이션을 그대로 박제한다는 컨셉.

wall에 painted 배경 깔기. 처음엔 conrete vibe였는데 너무 cold해서
warm wash 더하고, lamp overlay (upper right corner에서 따뜻한 빛)
추가. floating dust motes 까지. lofi 무드가 살아났다. nav icon은
크게 세 번 바꿨다 (shovel → record-crate → pickaxe → 다시 crate).
crate가 가장 컬렉터다웠다.

snapshot save modal에서 CHECK constraint fix — 비슷한 슬러그가 이미
있을 때 안 깨지게. 가장 wasted한 시간은 nested BEGIN으로 마이그레이션
이 silent fail한 거 디버깅한 거. 30분 헤맸다. runOnce 안에 자체
transaction이 있어서 outer BEGIN과 충돌. 알게 된 후엔 깔끔.

mydig editor drag-drop 다시 손봤다. 어제 잡은 거랑 다른 부분에서 또
syntheticEvent issue. 결국 native dragstart listener로 우회. 후에
"remove dnd tracing logs — fix confirmed working" commit.

새벽 5시. 손가락에서 LP가 빈 슬롯에 떨어지는 거 작동하는 걸 확인하고
잤다.

---

## 4월 24일 (금) — Day 10

55 commit. 금요일이라 좀 더 무리했다.

home 페이지 큰 변화. desktop을 3:5 split했다 — 왼쪽 activity rail
(snapshots + comments), 오른쪽 album grid. rail toggle도 박았다. 사
용자가 closed 상태로 시작해서 클릭하면 펼쳐지는 구조. ticker recency
bias 추가 (최근 코멘트가 우선 노출되고 fresh-message는 잠깐 glow).
mydig wall 5개 노출하던 걸 11+5로 — 5개 큰 wall + 작은 5개 (LATEST
mydigs).

mydig editor에서 quick album registration 추가. 전체 탭에서 "DB에 없
는 앨범 등록" 칸. 작은 input으로 search → 결과 → [+] 버튼으로 즉시
등록. 들어와서 검색했는데 없는 album을 outside flow로 빠져나가지 말
라고. 사용자 retention 측면에서 중요하다.

**scratch snapshot flow**도 추가. "처음부터 새 기억" 옵션 — 빈 wall
에서 시작해서 큐레이션. 라이브 wall은 안 건드리고. 이게 의외로 PD
적인 발상이었다. 편집실에서 새 cut을 시작할 때 "raw footage만 있는
빈 timeline"이 좋잖아.

VinylDisc 디테일 작업. specular crescent (위쪽에 빛 반사하는 초승달)
+ banded grooves (vinyl 표면 나이테 같은 줄). 처음엔 grooves가 너무
규칙적이어서 "real vinyl 답지 않아"서 non-uniform spacing으로. 5
ring으로 줄였다가 한 ring 더 옮겨서 duplicate-pattern 깨고. 디테일
하나가 한 시간씩.

graffiti snapshot list. wall 옆 sidebar에 손글씨 폰트 (Gugi → Poor
Story로 결국 fix)로 snapshot 이름 적힌 list. 마치 레코드샵 벽에 마커
로 "이번 주 추천" 적어놓은 듯한 모양. graffiti라는 이름이 마음에 들
었다.

LP 사이즈 ~150px로, column gap 두 배로. avatar에 breathing room.
display name sticker. 작은 변경들이지만 누적되면 분위기가 진짜 다르
다.

새벽 6시. 5시간 자고 출근.

---

## 4월 25일 (토) — Day 11

59 commit. **Phase 3 close 결정한 날.**

처음엔 persistent player 디버깅으로 시작. 다른 페이지로 navigate해도
Spotify embed가 살아있게 만든 건데, key-based remount이 render tree를
깨먹는 케이스가 있어서 loadUri 방식으로 revert. wrapper도 mydig 떠도
visible 유지. 작은 거지만 사용자 경험에 큰 차이.

ProfileHeader 위치 고민 많이 했다. 처음엔 wall 위에 큰 사이즈로 →
desktop 사이드바 안 카드로 → 그 카드를 더 슬림하게 → 결국 "graffiti
signature"로 dissolve. avatar + display name + 짧은 graffiti 한 줄
만. 이게 lofi-bedroom 무드랑 가장 맞다. 사이드바 액션 (팔로우 / 공유)
은 위로 옮기고. snapshot date는 darken.

마지막에 "phase 3 closeout" commit 했다. avatar 업로드에 magic-byte
sniff (jpg/png/webp/avif/gif/heic 허용, 다른 파일 거부), profile column
allowlist (admin이 함부로 update 못하게), admin rate-limiter skip
(curation 빠른 리듬 유지), CLAUDE.md re-baseline. 다 깔끔해졌다.

오늘 진짜 한 일은 **post-Phase 3 roadmap 문서 만든 거**. 5개 시퀀싱
된 항목 (album page → crate → shop visual → topster PNG → social
ticker) + 6개 brainstorm (A-F: Discogs import, label pages, random
dig, daily log, liner notes, letter to stranger) + 4개 anti-features
(personalized recommendations, trending charts, live chat, AI voice).
**안 만들 것까지 명시한 게 마음에 들었다.** dig.haus의 정체성을 위해
서.

mydig가 끝났다는 게 이제 인정됐다. Shelf, Crate mutation endpoints,
illustrated storefront — 다 deferred로 넘겼다. 처음엔 "Shelf까지는
끝내야지 Phase 3가 닫히는 거 아니야?" 했는데, 다 만들고 나서 보니
없어도 사용자가 충분히 즐길 수 있더라. 잘 자른 결정이라고 생각한다.

mydig hotfix 한 개 — useNowPlaying이 early return 위에 있어서
hook order crash 났다. 이런 건 typecheck로 안 잡히고 런타임에 터진다.
디버깅 5분 만에 잡고 commit. 새벽 6시쯤 마무리.

phase 3 닫고 보니 후련하다. 한 chapter 끝나는 느낌.

---

## 4월 26일 (일) — Day 12

4 commit. 거의 하루 쉬었다.

home wall 모바일 폴리시 두 개만 — edit chip을 LP grid 위로 lift
(겹침 방지), 모바일 2×5 layout + cover hover tooltip drop + sticker
폴리시. 그게 다.

밤늦게 한 번 더 들어왔다가, **"home-next: scratch route for the
scrolling layered home"** commit. 새 home 화면 실험. 지금까지 home은
single-viewport에 큰 wall이 있고 그 아래 ticker였는데, 이걸 scrolling
layered home으로 바꾸면 어떨까 생각하다가 그냥 scratch route 만들어
서 실험만. 라이브 home은 안 건드리고. 잠들기 전 확인할 정도만.

오늘은 본업 일이 좀 쌓여있어서 쉴 수밖에 없었다. 어제까지 11일 연속
이었으니 한 번은 쉬어줘야 했다. 내일은 home 새 모양 본격적으로 잡아
보자.

---

## 4월 27일 (월) — Day 13

44 commit. 오늘 phase 3.5와 phase 4가 같은 날에 일어났다.

오전부터 home-next 본격화. **basement 콘셉트로 가기로.** 어제 만든
scratch route에 hero strip 깔고 — basement5 backdrop, slim band trim,
grounded shadows. 처음엔 전체 페이지를 wall로 채웠는데, 위에서부터
내려가는 *layered* 구조로 (hero 다음에 활동 섹션 → ticker → footer).
기존 single-viewport home wall (HomeWall.tsx)은 redundant라 삭제. /dig
은 catalog browse 전용 surface로. 이렇게 home + /dig + 모바일이 한
identity 안에 합쳐졌다. **Phase 3.5로 부르기로 결정** — 큰 phase는
아닌데 그렇다고 단순 polish도 아닌 정도.

tape-label section heads (붓글씨 같은 손글씨). hero LP에 X-tuner
split (upper row와 lower row 따로). mobile hero (desktop 자산은
phone에서 cropping이 너무 빡세서 별도 composition). /dig은 거의 그대로
.

photo backdrop on mobile. PICK sticker on cards (avg score ≥86 + 3+
scored reviews 조건). NEW → 날짜 sticker로 변경. tap-to-activate
on touch. mobile chevron drop, desktop chevron lift off the edge,
나중엔 chevron 자체 배치 미세 조정. plastic-wrap textures 10개를
position-indexed로 분배 — 같은 텍스처가 두 번 나오지 않게.

저녁쯤부터 **Phase 4**. RTX 5080 + Qwen3-14B로 야간 큐레이션
파이프라인. 30,000개 앨범까지 갈 거면 cloud Claude 비용 너무 크니까
local LLM이 답일 것이다. /admin/compare 페이지에 L0c blind-bench
harness 추가 — admin이 여러 모델 출력을 blind 비교하고 점수 매김.
data 모으기 시작.

**bench 결과가 안 좋았다.** Pre-L0 모델 출력이 Sonnet 대비 명확히
"기계 번역" 티가 났다. 한국어 미묘한 표현 (vinyl 컬렉터 어휘)이
무너지고. 비용은 줄지만 quality drop이 회복 안 될 정도. 같은 날
**phase 4 PARK 결정.** "phase 4: park local-LLM curation plan after
Pre-L0 fails" commit.

아쉽긴 했다. 며칠 머릿속으로 짠 계획이라. 그런데 PD 본업에서 며칠
준비한 게 한 시간 회의에서 엎어지는 거 익숙해서, 이런 결정엔 망설임
이 줄어든다. bench harness는 torn down했고, scripts/preL0-spot-check
.ts만 남겨뒀다 (다른 모델 평가할 때 다시 쓸 수 있게).

새벽 4시. 오늘 같은 날이 가장 흥미롭다 — 큰 결정 두 개 (3.5 close,
4 PARK)가 같이 일어나는.

---

## 4월 28일 (화) — Day 14

53 commit. 이번 주 가장 빡센 날.

본업 끝나고 자리 앉자마자 바로 **invitation gate**. 사이트가 너무
public하게 열려 있으면 DB 오염될 것 같다는 걱정이 점점 커졌다. 큐레이
션 정체성에 아무나 50자 평 쓰면 안 맞는다. 그래서 Google OAuth callback
에 allowlist 추가. invited_emails 테이블 + pending_signups 테이블 두
개 박았다. 기존 유저는 grandfather 마이그레이션으로 자동 통과 (로그인
안 끊기게). 신규는 admin 검토 대기 큐로. fpp@dig.haus로 알림 메일은
Resend로. admin 패널에 가입 신청 panel 추가. invitation gate 한 commit
에 다 박아냈다.

그 다음에 큰 작업 — **multi-wall hero carousel**. home hero를 단일
wall에서 N개 wall로 확장. day 0 plan에는 없던 거지만, 오전부터 갑자기
"이 사이트는 한 wall만으로는 부족해, 여러 큐레이션 트랙이 있어야 해"
라는 생각이 들었다.

stage 별로 진행 — (1) schema (home_walls 테이블 + home_features.wall
_id FK + grandfather migration), (2) server 응답 walls[], (3) 클라이
언트 carousel UI. 셋 다 한 세션에 박았다. backdrop 자산이 처음엔
basement_purple/black/plant였는데, plant가 너무 풀숲이라 별로 — 다음
날 hero_afternoon (밝은 cream) + hero_purple (다크 플럼) + hero_basement
(콜드 블랙)로 바꾸기로.

**그러다가 사용자 (나) 가 "스포티파이 음반 못 가져온다"는 거 보고.**
Hawthorne Heights — *If Only You Were Lonely* 같은 너무 빈한 album을
검색해도 0 떨어지는 게 이상해서 진단. 코드 보니까 `q: artist:Hawthorne
Heights album:If Only You Were Lonely` 이렇게 나가는데, **Spotify
parser가 따옴표 없으면 첫 단어만 artist 필드로 받고 나머지 free text로
처리.** 그래서 multi-word artist + multi-word album이 다 실패하던 거.

쉽게 풀 수 있는 거. artist:"Hawthorne Heights" album:"If Only You
Were Lonely"로 quoted fields. 거기에 fallback chain (primary artist만,
parenthetical strip, free-text 자연어). live test에서 Hawthorne
Heights — *If Only You Were Lonely* 라이브 확인 OK.

다른 fallback case 확인하려고 batch test 돌렸다가 **Spotify 429 cooldown**
에 걸렸다. Retry-After 7918초 (~2.2시간). 30일 rolling window의 burst
protection. 일단 cooldown gate 박아두기 — 한 번 429 받으면 모듈 레벨
timestamp 박아서 그동안의 모든 호출 즉시 null return. amplification
방지.

backfill 엔드포인트도 만들었다. cooldown 풀린 다음 spotify_url=null
인 album들을 한 번에 다시 검색. 250ms throttle.

밤엔 carousel 마무리 작업. wall 순서 변경 (admin only ← →), session
Storage로 last-viewed wall 기억, auto-advance (7초마다, hover/touch
시 정지, prefers-reduced-motion respect), scroll-hint chevron 제거
(carousel dots랑 겹쳐서). 이거 다 한 commit씩 작은 단위로 짜고 push.

마지막 commit이 새벽 4시쯤. 53 commit 한 날 치고는 dot pagination이
깔끔하게 작동하고 swipe 페이스도 자연스러워서 만족.

---

## 4월 29일 (수) — Day 15

오늘은 commit 적게. 2개 + docs 일기.

오전에 한국어 정규화 한 줄 — **에모 → 이모.** 메탈 / 하드코어 인접
컬렉터들은 emo를 *이모*로 부르지 *에모*로 안 부른다. claude.ts의
normaliseKoreanTerms 마지막에 패턴 추가. 그리고 이미 DB에 박혀있는
요약 / 발췌도 SQL UPDATE 한 번에 일괄 정리 (`schema: one-shot 에모 →
이모 backfill`). 로컬 DB는 reviews에 1건만 있었고, 프로덕션은 다음
배포에서 자동 적용.

오후엔 **이 16일을 정리하기로 했다.** Spotify cooldown 풀리길 기다
리는 시간이라, 작업 페이스 잠깐 조절. 16일짜리 narrative 로그를
docs/project-log.md에 썼다 — phase 별 정리, 결정 흐름, 어디에 다른
artifacts (CLAUDE.md, decisions log, memory) 있는지. 그 다음에 day 0
의 원본 conversation도 빠진 걸 발견하고 별도 섹션 추가. 두 browser
session (claude.ai 기획 + Claude Code 빌드) 분리도. 600 commit + 7개
docs + 16개 memory 파일을 하나의 read-through에 압축.

그 다음에 Claude한테 "내가 어떤 사람으로 보이냐"를 물었다. 본업이
17년차 한국 예능 PD라는 걸 흘리니까 그동안의 모든 패턴 — cost
discipline, 결정 위생, 야간 내성, anti-algorithm 정체성, production
design 감수성 — 이 다 그쪽에서 transfer된 거라는 게 정리됐다. "첫
vibe coding"이 아니라 "PD가 처음 product로 만든 작품"이 정확한
framing이라는 것. modesty 모드로 자기 무게 줄여 말하는 습관도 짚어
졌다.

마지막으로 **이 일기.** 내가 43살이 되니까 기억력이 자꾸 떨어진다.
폭풍처럼 만든 16일 동안 너무 많은 일이 있어서 이미 잘 기억 안 나는
부분이 많다. 앞으로 다시 보고 싶을 때, 또는 product가 어느 정도 모양
잡힌 다음 누군가에게 보여주고 싶을 때, 이 기록이 있어야 할 것 같
았다. 평어체 1인칭 일기 형식으로. 자세히.

지금 시간은 자정 가까이. 16일 첫 chapter는 여기서 끝나는 것 같다.
다음 chapter는 사용자가 들어오기 시작하면서 시작될 거다. 어떤 모양일
지 아직 모르겠다.

— 4월 29일 밤
