import type { StreamingLinks } from '../../types';

const services = [
  {
    key: 'spotify' as const,
    name: 'Spotify',
    color: '#1DB954',
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
      </svg>
    ),
  },
  {
    key: 'appleMusic' as const,
    name: 'Apple Music',
    color: '#FC3C44',
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
        <path d="M23.994 6.124a9.23 9.23 0 00-.24-2.19c-.317-1.31-1.062-2.31-2.18-3.043A5.022 5.022 0 0019.7.165a10.18 10.18 0 00-1.564-.12C17.596.01 17.052 0 15.62 0H8.382c-1.434 0-1.978.01-2.518.045A10.18 10.18 0 004.3.165a5.02 5.02 0 00-1.874.716C1.31 1.597.565 2.597.248 3.908a9.23 9.23 0 00-.24 2.19C-.004 6.636 0 7.18 0 8.612v6.776c0 1.434-.004 1.978.008 2.518.02.74.08 1.468.24 2.19.317 1.31 1.062 2.31 2.18 3.043A5.02 5.02 0 004.3 23.835c.516.07 1.04.112 1.564.12.54.034 1.084.045 2.518.045h7.236c1.434 0 1.978-.01 2.518-.045a10.18 10.18 0 001.564-.12 5.022 5.022 0 001.874-.716c1.118-.733 1.863-1.733 2.18-3.043a9.23 9.23 0 00.24-2.19c.012-.54.008-1.084.008-2.518V8.612c0-1.434.004-1.978-.008-2.518zM17.02 17.61c0 .54-.18.96-.54 1.26s-.78.42-1.26.36a1.58 1.58 0 01-1.02-.54c-.24-.3-.36-.66-.36-1.08V9.87l-6.96 1.5v7.23c0 .54-.18.96-.54 1.26s-.78.42-1.26.36a1.58 1.58 0 01-1.02-.54c-.24-.3-.36-.66-.36-1.08 0-.54.18-.96.54-1.26s.78-.42 1.26-.36c.36.06.66.24.9.48V8.04c0-.36.12-.66.36-.9.24-.24.54-.42.9-.48l7.44-1.62c.36-.06.66 0 .9.18s.36.42.36.72v11.67z" />
      </svg>
    ),
  },
  {
    key: 'youtube' as const,
    name: 'YouTube',
    color: '#FF0000',
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
        <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    ),
  },
  {
    key: 'bandcamp' as const,
    name: 'Bandcamp',
    color: '#1DA0C3',
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
        <path d="M0 18.75l7.437-13.5H24l-7.438 13.5H0z" />
      </svg>
    ),
  },
];

export default function ListenSection({ streaming }: { streaming: StreamingLinks }) {
  const availableServices = services.filter((s) => streaming[s.key] !== null);

  return (
    <section>
      <h2
        className="text-2xl font-bold text-white mb-6 font-serif"
      >
        듣기
      </h2>

      {availableServices.length === 0 ? (
        <p className="text-gray-500">스트리밍 링크를 찾을 수 없습니다</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {availableServices.map((service) => (
            <a
              key={service.key}
              href={streaming[service.key]!}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 bg-[#1a1a1a] rounded-lg px-4 py-3 hover:bg-[#252525] transition-colors group"
            >
              <span style={{ color: service.color }}>{service.icon}</span>
              <span className="text-sm text-gray-300 group-hover:text-white transition-colors">
                {service.name}
              </span>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
