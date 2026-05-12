import { useState, type ReactNode } from 'react';
import { Popover } from './ui';

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
        <Popover
          strong={false}
          tone="accent"
          radius="md"
          shadow="lg"
          className="absolute left-1/2 -translate-x-1/2 top-full mt-2 whitespace-nowrap !py-1.5 !px-3 text-accent text-xs z-50 pointer-events-none"
        >
          입장하기(로그인)가 필요합니다
        </Popover>
      )}
    </div>
  );
}
