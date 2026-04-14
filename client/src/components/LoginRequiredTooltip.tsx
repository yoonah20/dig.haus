import { useState, type ReactNode } from 'react';

/**
 * Wraps a child that requires login. If the user is not logged in, clicks
 * surface a small tooltip "입장하기(로그인)가 필요합니다" instead of the child's action.
 */
export default function LoginRequiredTooltip({
  locked,
  children,
}: {
  locked: boolean;
  children: ReactNode;
}) {
  const [show, setShow] = useState(false);

  if (!locked) return <>{children}</>;

  return (
    <div className="relative inline-block">
      <div
        onClickCapture={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setShow(true);
          setTimeout(() => setShow(false), 2000);
        }}
      >
        {children}
      </div>
      {show && (
        <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 whitespace-nowrap bg-[#1a1a1a] border border-[#e8a020]/40 text-[#e8a020] text-xs rounded-md px-3 py-1.5 shadow-lg z-50 pointer-events-none">
          입장하기(로그인)가 필요합니다
        </div>
      )}
    </div>
  );
}
