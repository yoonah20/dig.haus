import Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | null = null;
export function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ maxRetries: 5 });
  return _client;
}

export const HAIKU = 'claude-haiku-4-5-20251001';
export const SONNET = 'claude-sonnet-4-5';

/**
 * Generate Korean pronunciation + meaning for artist/album.
 */
export async function generatePronunciation(
  artist: string,
  album: string
): Promise<{ artistKo: string; titleKo: string; titleMeaning: string } | null> {
  try {
    const message = await getClient().messages.create({
      model: HAIKU,
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `JSON only: {"artistKo":"${artist} 한국어 발음","titleKo":"${album} 한국어 발음","titleMeaning":"${album} 한국어 뜻"}

titleMeaning 규칙:
- 반드시 번역 하나만 제공. 여러 후보를 슬래시(/)나 쉼표로 나열 금지.
- 가장 자연스럽고 의미 전달이 잘 되는 한국어 번역 하나만 선택.
- 고유명사이거나 번역이 불필요한 경우 빈 문자열("").

예:
- Hellripper → {"artistKo":"헬리퍼","titleKo":"헬리퍼","titleMeaning":""}
- Master of Puppets → {"titleKo":"마스터 오브 퍼펫츠","titleMeaning":"인형의 지배자"}
- Love Is Not Enough → {"titleKo":"러브 이즈 낫 이너프","titleMeaning":"사랑은 충분하지 않다"}
- Coronach → {"titleKo":"코로나크","titleMeaning":"장송곡"}
- Datalysium → {"titleKo":"데이터리시움","titleMeaning":""}`,
      }],
    });
    const text = message.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return null;
    const match = text.text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    // Defensive: if the model still emits "A/B" despite instructions,
    // keep only the first option.
    const rawMeaning = parsed.titleMeaning || '';
    const titleMeaning = rawMeaning.includes('/')
      ? rawMeaning.split('/')[0].trim()
      : rawMeaning;
    return {
      artistKo: parsed.artistKo || '',
      titleKo: parsed.titleKo || '',
      titleMeaning,
    };
  } catch (err) {
    console.warn(`[claude] generatePronunciation failed for "${artist} - ${album}":`, (err as Error).message);
    return null;
  }
}

/**
 * Generate Korean summary from cached reviews (fallback when reviews exist but no summary).
 */
export async function generateKoreanSummary(
  albumTitle: string,
  artist: string,
  reviews: Array<{ source: string; score?: number; excerpt?: string }>
): Promise<string | null> {
  try {
    const reviewsText = reviews
      .map((r) => `[${r.source}]${r.score ? ` (${r.score}/100)` : ''}: ${r.excerpt || ''}`)
      .join('\n');

    const message = await getClient().messages.create({
      model: SONNET,
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `'${albumTitle}' by ${artist} 리뷰 3-4문장 한국어 요약. 매체명 금지. 평론가 시점으로 앨범의 분위기, 사운드 특징, 컬렉팅 가치를 서술.\n${reviewsText}`,
      }],
    });

    const textBlock = message.content.find((b) => b.type === 'text');
    return textBlock ? textBlock.text : null;
  } catch (err) {
    console.warn(`[claude] generateKoreanSummary failed for "${artist} - ${albumTitle}":`, (err as Error).message);
    return null;
  }
}

/**
 * Generate Korean descriptions for similar albums.
 */
export async function generateSimilarDescriptions(
  baseArtist: string,
  baseAlbum: string,
  similarAlbums: Array<{ title: string; artist: string }>
): Promise<Array<{ title: string; artist: string; descriptionKo: string }> | null> {
  if (similarAlbums.length === 0) return [];

  const list = similarAlbums.map((a, i) => `${i + 1}. "${a.title}" by ${a.artist}`).join('\n');

  try {
    const message = await getClient().messages.create({
      model: HAIKU,
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `"${baseAlbum}" by ${baseArtist} 팬을 위한 비슷한 앨범 설명. 각 1-2문장 한국어.
${list}
JSON array only: [{"title":"","artist":"","descriptionKo":""}]`,
      }],
    });

    const textBlock = message.content.find((b) => b.type === 'text');
    if (!textBlock) return null;
    const jsonMatch = textBlock.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((item: any) => ({
      title: item.title || '',
      artist: item.artist || '',
      descriptionKo: item.descriptionKo || '',
    }));
  } catch (err) {
    console.warn(`[claude] generateSimilarDescriptions failed for "${baseArtist} - ${baseAlbum}":`, (err as Error).message);
    return null;
  }
}
