// Skeleton placeholders for the album page during baseLoading. Mirrors
// the live layout in `pages/Album.tsx` + `components/AlbumDetail/HeaderSection.tsx`:
// max-w-[1120px] container, side-by-side cover + info header on md+, then a
// 1fr / 280px body grid (reviews | buy + 50자 평) on lg+. TopNav is rendered
// upstream in App.tsx, so the skeleton must not draw its own.
export default function LoadingSkeleton() {
  return (
    <div className="flex-1 px-4">
      <main className="max-w-[1120px] mx-auto py-8">
        {/* Header: cover + info side-by-side on md+ */}
        <div className="flex flex-col md:flex-row md:gap-6">
          {/* Cover */}
          <div className="w-full md:w-[22rem] flex-shrink-0">
            <div className="aspect-square bg-panel rounded-panel animate-pulse" />
          </div>

          {/* Info column */}
          <div className="flex flex-col flex-1 min-w-0 p-4 md:pl-0">
            <div>
              {/* Artist */}
              <div className="h-7 w-1/2 bg-panel rounded animate-pulse mb-2" />
              {/* Title */}
              <div className="h-10 w-3/4 bg-panel rounded animate-pulse mb-3" />
              {/* Korean translation line */}
              <div className="h-4 w-1/3 bg-panel rounded animate-pulse mb-3" />
              {/* Release date · label */}
              <div className="h-4 w-2/5 bg-panel rounded animate-pulse mb-6" />

              {/* Action bar: vote + crate */}
              <div className="flex gap-2 py-3 mb-6">
                <div className="h-10 w-36 bg-panel rounded-full animate-pulse" />
                <div className="h-10 w-24 bg-panel rounded-full animate-pulse" />
              </div>

              {/* Genre tags */}
              <div className="flex flex-wrap gap-2 mb-6">
                <div className="h-6 w-16 bg-panel rounded-full animate-pulse" />
                <div className="h-6 w-20 bg-panel rounded-full animate-pulse" />
                <div className="h-6 w-14 bg-panel rounded-full animate-pulse" />
              </div>
            </div>

            {/* Streaming link buttons */}
            <div className="flex flex-wrap gap-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-9 w-24 bg-panel rounded-lg animate-pulse" />
              ))}
            </div>
          </div>
        </div>

        {/* Body grid: reviews (wide) | buy + 50자 평 (narrow) */}
        <div className="mt-10 lg:grid lg:grid-cols-[1fr_280px] lg:gap-8 lg:items-start">
          {/* Reviews column */}
          <div className="space-y-4">
            {/* Korean summary block */}
            <div className="h-32 w-full bg-panel rounded-lg animate-pulse" />
            {/* Average score chip */}
            <div className="h-12 w-40 bg-panel rounded-lg animate-pulse" />
            {/* Review entries */}
            <div className="space-y-3 pt-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-24 w-full bg-panel rounded-lg animate-pulse" />
              ))}
            </div>
          </div>

          {/* Right sidebar: BuySection + UserReviewsSection */}
          <div className="mt-8 lg:mt-0 space-y-6">
            <div className="h-56 w-full bg-panel rounded-lg animate-pulse" />
            <div className="h-40 w-full bg-panel rounded-lg animate-pulse" />
          </div>
        </div>

        {/* Similar albums grid */}
        <div className="mt-10 space-y-3">
          <div className="h-5 w-32 bg-panel rounded animate-pulse" />
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-2">
                <div className="aspect-square bg-panel rounded-panel animate-pulse" />
                <div className="h-4 w-3/4 bg-panel rounded animate-pulse" />
                <div className="h-3 w-1/2 bg-panel rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
