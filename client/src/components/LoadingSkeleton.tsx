export default function LoadingSkeleton() {
  return (
    <div className="flex-1">
      {/* Nav bar skeleton */}
      <nav className="border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="h-7 w-36 bg-[#1a1a1a] rounded animate-pulse" />
          <div className="h-10 w-64 bg-[#1a1a1a] rounded-lg animate-pulse" />
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Album header: cover + info */}
        <div className="flex flex-col md:flex-row gap-8">
          {/* Cover art */}
          <div className="w-full md:w-80 aspect-square bg-[#1a1a1a] rounded-xl animate-pulse flex-shrink-0" />

          {/* Album info */}
          <div className="flex-1 space-y-4 py-2">
            {/* Title */}
            <div className="h-8 w-3/4 bg-[#1a1a1a] rounded animate-pulse" />
            {/* Artist */}
            <div className="h-5 w-1/2 bg-[#1a1a1a] rounded animate-pulse" />
            {/* Year / format / label */}
            <div className="flex gap-3">
              <div className="h-4 w-16 bg-[#1a1a1a] rounded animate-pulse" />
              <div className="h-4 w-20 bg-[#1a1a1a] rounded animate-pulse" />
              <div className="h-4 w-24 bg-[#1a1a1a] rounded animate-pulse" />
            </div>
            {/* Genre tags */}
            <div className="flex gap-2 pt-2">
              <div className="h-6 w-16 bg-[#1a1a1a] rounded-full animate-pulse" />
              <div className="h-6 w-20 bg-[#1a1a1a] rounded-full animate-pulse" />
              <div className="h-6 w-14 bg-[#1a1a1a] rounded-full animate-pulse" />
            </div>
            {/* Score */}
            <div className="h-10 w-24 bg-[#1a1a1a] rounded-lg animate-pulse mt-4" />
          </div>
        </div>

        {/* Streaming links section */}
        <div className="mt-10 space-y-3">
          <div className="h-5 w-28 bg-[#1a1a1a] rounded animate-pulse" />
          <div className="flex gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-12 w-32 bg-[#1a1a1a] rounded-lg animate-pulse"
              />
            ))}
          </div>
        </div>

        {/* Buy section */}
        <div className="mt-10 space-y-3">
          <div className="h-5 w-20 bg-[#1a1a1a] rounded animate-pulse" />
          <div className="h-24 w-full bg-[#1a1a1a] rounded-lg animate-pulse" />
        </div>

        {/* Reviews section */}
        <div className="mt-10 space-y-3">
          <div className="h-5 w-16 bg-[#1a1a1a] rounded animate-pulse" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-20 w-full bg-[#1a1a1a] rounded-lg animate-pulse"
              />
            ))}
          </div>
        </div>

        {/* Similar albums section */}
        <div className="mt-10 space-y-3">
          <div className="h-5 w-32 bg-[#1a1a1a] rounded animate-pulse" />
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="space-y-2">
                <div className="aspect-square bg-[#1a1a1a] rounded-xl animate-pulse" />
                <div className="h-4 w-3/4 bg-[#1a1a1a] rounded animate-pulse" />
                <div className="h-3 w-1/2 bg-[#1a1a1a] rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
