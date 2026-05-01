import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useAlbumRequests } from '../hooks/useAlbumRequests';
import { parseServerTimestamp } from '../utils/relativeTime';
import { ADMIN_SEEN_PENDING_KEY } from '../lib/adminSeen';
import { resolveApiUrl } from '../utils/apiUrl';

// Top-right nav affordance. Absorbs the admin pending-requests badge
// (previously a separate bell) so the nav stays clean — count shows
// as a small red circle on the user's avatar pill, and the dropdown
// surfaces the same count next to "관리자 대시보드". The count is
// the number of user-submitted pending albums whose createdAt is
// newer than the admin's last Admin-page visit (localStorage). Visit
// the admin page and the badge clears.
export default function LoginButton() {
  const { user, loading, login, logout } = useAuth();
  const navigate = useNavigate();
  const isAdmin = !!user?.isAdmin;
  const requestsQuery = useAlbumRequests(isAdmin);
  // Re-read the seen-at timestamp on each render cycle so the badge
  // clears immediately after visiting the admin page (which writes
  // to the same key). useSyncExternalStore-level reactivity isn't
  // worth it for a value that changes once per navigation.
  const [seenAt, setSeenAt] = useState<string | null>(null);
  useEffect(() => {
    setSeenAt(localStorage.getItem(ADMIN_SEEN_PENDING_KEY));
    function onStorage(e: StorageEvent) {
      if (e.key === ADMIN_SEEN_PENDING_KEY) {
        setSeenAt(localStorage.getItem(ADMIN_SEEN_PENDING_KEY));
      }
    }
    window.addEventListener('storage', onStorage);
    // Custom event for same-tab updates (storage event doesn't fire
    // in the tab that wrote the value).
    function onLocalUpdate() {
      setSeenAt(localStorage.getItem(ADMIN_SEEN_PENDING_KEY));
    }
    window.addEventListener('admin-pending-seen', onLocalUpdate);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('admin-pending-seen', onLocalUpdate);
    };
  }, []);
  const seenTs = seenAt ? parseServerTimestamp(seenAt).getTime() : 0;
  const pendingCount = (requestsQuery.data?.requests ?? []).filter((r) => {
    const t = parseServerTimestamp(r.createdAt).getTime();
    return Number.isFinite(t) && t > seenTs;
  }).length;
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
    return <div className="w-20 h-8 bg-white/5 rounded-full animate-pulse" />;
  }

  if (!user) {
    return (
      <div className="relative" ref={consentRef}>
        <button
          onClick={() => setConsentOpen((v) => !v)}
          className="px-4 py-1.5 border border-[#e8a020]/60 text-[#e8a020] hover:bg-[#e8a020] hover:text-black rounded-full text-sm font-medium tracking-wide transition-colors cursor-pointer"
          title="Google 계정으로 입장하기"
        >
          입장하기
        </button>
        {consentOpen && (
          <div
            role="dialog"
            aria-label="로그인 동의"
            className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] bg-[#141414] border border-white/10 rounded-2xl p-5 shadow-2xl z-50"
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
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setMenuOpen((v) => !v)}
        // Mobile collapses the pill to a circle (avatar only) — the
        // bigger sticker logo on the left already eats the nav row,
        // so dropping the username text frees space without losing
        // identity. sm+ restores the pill with name alongside.
        className="relative flex items-center gap-0 sm:gap-2 border border-[#e8a020]/60 hover:bg-[#e8a020]/10 rounded-full p-0.5 sm:pl-1 sm:pr-3 sm:py-1 transition-colors cursor-pointer"
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
        <span className="hidden sm:inline text-sm text-[#e8a020] max-w-[120px] truncate">
          {user.name || user.email}
        </span>
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
        <div className="absolute right-0 mt-2 w-56 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-2xl py-1 z-50">
          <Link
            to="/profile"
            onClick={() => setMenuOpen(false)}
            className="block px-4 py-2 text-sm text-gray-200 hover:bg-white/5"
          >
            🧑‍🎤 내 프로필
          </Link>
          {user.isAdmin && (
            // Always open in a new tab — admin tends to reference the
            // dashboard while also keeping the site browsing tab alive
            // (copy a review URL from /admin, paste into a retry flow
            // on /album/:slug, etc.). Anchor instead of a button with
            // window.open so middle-click / ctrl-click still work and
            // the accessible open-in-new-tab affordances are preserved.
            <a
              href="/admin"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMenuOpen(false)}
              className="w-full text-left flex items-center gap-2 px-4 py-2 text-sm text-[#e8a020] hover:bg-white/5 cursor-pointer"
            >
              <span>🛠 관리자 대시보드</span>
              {pendingCount > 0 && (
                <span className="ml-auto min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none px-1">
                  {pendingCount}
                </span>
              )}
            </a>
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
