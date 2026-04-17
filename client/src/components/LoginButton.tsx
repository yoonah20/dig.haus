import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useAlbumRequests } from '../hooks/useAlbumRequests';
import { resolveApiUrl } from '../utils/apiUrl';

// Fixed bottom-left auth affordance. Used to sit in the top-right of
// the nav next to search/sort; moved here so it stays put as the user
// scrolls and absorbs the admin pending-requests badge that previously
// lived beside it. Menu and consent popovers open upward so they don't
// fall off the bottom of the viewport.
export default function LoginButton() {
  const { user, loading, login, logout } = useAuth();
  const navigate = useNavigate();
  const isAdmin = !!user?.isAdmin;
  const requestsQuery = useAlbumRequests(isAdmin);
  const pendingCount = requestsQuery.data?.requests.length ?? 0;
  const [menuOpen, setMenuOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const consentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [menuOpen]);

  // Close the consent popover on Escape and on outside click. The popover
  // is anchored above the 입장하기 button (no fullscreen backdrop), so we
  // need an explicit document listener to dismiss it.
  useEffect(() => {
    if (!consentOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setConsentOpen(false);
    }
    function onClickOutside(e: MouseEvent) {
      if (consentRef.current && !consentRef.current.contains(e.target as Node)) {
        setConsentOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [consentOpen]);

  if (loading) {
    return (
      <div className="fixed bottom-4 left-4 z-40">
        <div className="w-20 h-8 bg-white/5 rounded-full animate-pulse" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="fixed bottom-4 left-4 z-40" ref={consentRef}>
        <button
          onClick={() => setConsentOpen((v) => !v)}
          className="px-4 py-1.5 border border-[#e8a020]/60 text-[#e8a020] bg-[#120c05]/90 backdrop-blur-sm hover:bg-[#e8a020] hover:text-black rounded-full text-sm font-medium tracking-wide transition-colors cursor-pointer shadow-lg"
          title="Google 계정으로 입장하기"
        >
          입장하기
        </button>
        {consentOpen && (
          <div
            role="dialog"
            aria-label="로그인 동의"
            className="absolute left-0 bottom-full mb-2 w-80 max-w-[calc(100vw-2rem)] bg-[#141414] border border-white/10 rounded-2xl p-5 shadow-2xl z-50"
          >
            <h2 className="text-base font-semibold text-white mb-3">
              로그인하기 전에
            </h2>
            <p className="text-sm text-gray-300 leading-relaxed mb-4">
              Google 계정으로 로그인하면 dig.haus의{' '}
              <a
                href="/terms.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#e8a020] hover:underline"
              >
                이용약관
              </a>
              과{' '}
              <a
                href="/privacy.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#e8a020] hover:underline"
              >
                개인정보처리방침
              </a>
              에 동의한 것으로 간주됩니다. Google 프로필의 이름·이메일·
              아바타만 가져오며 그 외 정보에는 접근하지 않습니다.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConsentOpen(false)}
                className="px-3 py-1.5 text-sm text-gray-400 hover:text-white cursor-pointer"
              >
                취소
              </button>
              <button
                onClick={() => {
                  setConsentOpen(false);
                  login();
                }}
                className="px-3 py-1.5 text-sm bg-[#e8a020] text-black rounded-md hover:bg-[#f0b040] cursor-pointer font-medium"
              >
                동의하고 계속
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 z-40" ref={menuRef}>
      <button
        onClick={() => setMenuOpen((v) => !v)}
        className="relative flex items-center gap-2 border border-[#e8a020]/60 bg-[#120c05]/90 backdrop-blur-sm hover:bg-[#e8a020]/15 rounded-full pl-1 pr-3 py-1 transition-colors cursor-pointer shadow-lg"
      >
        {user.avatarUrl ? (
          <img
            src={resolveApiUrl(user.avatarUrl) ?? undefined}
            alt={user.name || user.email}
            className="w-7 h-7 rounded-full border border-[#e8a020]/40"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-[#e8a020]/20 text-[#e8a020] flex items-center justify-center text-xs font-bold">
            {(user.name || user.email)[0]?.toUpperCase()}
          </div>
        )}
        <span className="text-sm text-[#e8a020] max-w-[120px] truncate">
          {user.name || user.email}
        </span>
        {/* Admin-only pending-requests badge. Overlaps the top-right
            of the pill so the nav never had to carry a separate bell
            button. Click behaviour is still handled by the pill
            (opens the menu → 관리자 대시보드); the badge is visual. */}
        {isAdmin && pendingCount > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none px-1 border border-[#120c05]"
            title={`등록 요청 ${pendingCount}건`}
            aria-label={`등록 요청 ${pendingCount}건 대기 중`}
          >
            {pendingCount}
          </span>
        )}
      </button>

      {menuOpen && (
        <div className="absolute left-0 bottom-full mb-2 w-56 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-2xl py-1 z-50">
          <Link
            to="/profile"
            onClick={() => setMenuOpen(false)}
            className="block px-4 py-2 text-sm text-gray-200 hover:bg-white/5"
          >
            🧑‍🎤 내 프로필
          </Link>
          {user.isAdmin && (
            <button
              onClick={() => {
                setMenuOpen(false);
                navigate('/admin');
              }}
              className="w-full text-left flex items-center gap-2 px-4 py-2 text-sm text-[#e8a020] hover:bg-white/5 cursor-pointer"
            >
              <span>🛠 관리자 대시보드</span>
              {pendingCount > 0 && (
                <span className="ml-auto min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none px-1">
                  {pendingCount}
                </span>
              )}
            </button>
          )}
          <button
            onClick={async () => {
              setMenuOpen(false);
              await logout();
            }}
            className="block w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-white/5 cursor-pointer"
          >
            퇴장하기 (로그아웃)
          </button>
        </div>
      )}
    </div>
  );
}
