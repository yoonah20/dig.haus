import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function LoginButton() {
  const { user, loading, login, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  if (loading) {
    return <div className="w-20 h-8 bg-white/5 rounded-full animate-pulse" />;
  }

  if (!user) {
    return (
      <button
        onClick={login}
        className="px-4 py-1.5 border border-[#e8a020]/60 text-[#e8a020] hover:bg-[#e8a020] hover:text-black rounded-full text-sm font-medium tracking-wide transition-colors cursor-pointer"
        title="Google 계정으로 입장하기"
      >
        입장하기
      </button>
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
            src={user.avatarUrl}
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
