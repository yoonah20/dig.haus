import type { LabelInfo } from '../../types';

export default function LabelSection({ label }: { label: LabelInfo }) {
  return (
    <section>
      <h2
        className="text-2xl font-bold text-white mb-6 font-serif"
      >
        레이블 정보
      </h2>

      <div className="bg-[#1a1a1a] rounded-xl p-6">
        {/* Label Header */}
        <h3 className="text-xl font-bold text-white mb-3">{label.name}</h3>

        <div className="flex items-center gap-2 text-gray-400 text-sm mb-6 flex-wrap">
          {label.foundingYear && <span>설립 {label.foundingYear}</span>}
          {label.country && (
            <>
              {label.foundingYear && <span className="text-gray-600">&middot;</span>}
              <span>{label.country}</span>
            </>
          )}
          {label.genreFocus && (
            <>
              {(label.foundingYear || label.country) && (
                <span className="text-gray-600">&middot;</span>
              )}
              <span>{label.genreFocus}</span>
            </>
          )}
        </div>

        {/* Notable Releases */}
        {label.notableReleases.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-gray-400 mb-3">주요 발매작</h4>
            <div className="flex gap-4 overflow-x-auto pb-2 -mx-2 px-2 scrollbar-thin scrollbar-thumb-gray-700">
              {label.notableReleases.map((release, idx) => (
                <div
                  key={idx}
                  className="flex-shrink-0 w-36 bg-white/5 rounded-lg p-3"
                >
                  <p className="text-white text-sm font-medium truncate" title={release.title}>
                    {release.title}
                  </p>
                  <p className="text-gray-400 text-xs truncate" title={release.artist}>
                    {release.artist}
                  </p>
                  {release.year && (
                    <p className="text-gray-600 text-xs mt-1">{release.year}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
