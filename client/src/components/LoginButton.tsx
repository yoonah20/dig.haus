import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { resolveApiUrl } from '../utils/apiUrl';

export default function LoginButton() {
  const { user, loading, login, logout } = useAuth();
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
  // is anchored under the 입장하기 button (no fullscreen backdrop), so we
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
    return <div className="w-20 h-8 bg-white/5 rounded-full animate-pulse" />;
  }

  if (!user) {
    // Anchor the consent text right under the 입장하기 button as a popover
    // (vs. a centered modal). A centered fixed-position modal was clipping
    // off the top of the viewport on short screens — the top of the
    // consent text sat above the visible area with no way to scroll up to
    // it. Putting the popover next to the trigger also makes it obvious
    // what the popover relates to.
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
          // right-0 keeps the popover flush with the button's right edge so
          // it never extends past the viewport on the narrow side. Width
          // caps to viewport-minus-gutters on small screens.
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
        className="flex items-center gap-2 border border-[#e8a020]/60 hover:bg-[#e8a020]/10 rounded-full pl-1 pr-3 py-1 transition-colors cursor-pointer"
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
      </button>

      {menuOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-2xl py-1 z-50">
          <Link
            to="/profile"
            onClick={() => setMenuOpen(false)}
            className="block px-4 py-2 text-sm text-gray-200 hover:bg-white/5"
          >
            🧑‍🎤 내 프로필
          </Link>
          {user.isAdmin && (
            <Link
              to="/admin"
              onClick={() => setMenuOpen(false)}
              className="block px-4 py-2 text-sm text-[#e8a020] hover:bg-white/5"
            >
              🛠 관리자 대시보드
            </Link>
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
