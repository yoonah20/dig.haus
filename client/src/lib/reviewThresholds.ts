// Minimum number of scored reviews before we surface an average. One
// or two hot takes can skew the headline average in misleading ways
// — the home-grid cover glow, the back-face score on album cards,
// and the 리뷰 모음집 headline on the album page all gate on this.
//
// Server-side: reviews.reviewCount already counts scored reviews only
// (ALBUM_ROW_SELECT filters COALESCE(manual_score, score) IS NOT NULL),
// so clients can compare reviewCount directly against this constant.
export const MIN_SCORED_FOR_AVG = 3;
