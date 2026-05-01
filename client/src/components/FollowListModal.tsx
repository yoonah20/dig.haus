import { Link } from 'react-router-dom';
import { useFollowers, useFollowing } from '../hooks/useFollow';
import FollowButton from './FollowButton';
import { resolveApiUrl } from '../utils/apiUrl';
import { DigmanEmpty } from './ui';

// Modal that lists a user's followers or followings. Two columns
// aren't needed — it's a single column of rows, each row carrying
// avatar + name + follow button (so the viewer can follow back
// without leaving the modal). Empty state is a muted one-liner
// rather than a placeholder illustration.

type Kind = 'followers' | 'following';

export default function FollowListModal({
  userId,
  kind,
  title,
  onClose,
}: {
  userId: number;
  kind: Kind;
  title: string;
  onClose: () => void;
}) {
  // Conditional hook swap between the two list endpoints. They
  // return the same shape so the render logic below is shared;
  // the kind prop only picks the source.
  const followers = useFollowers(kind === 'followers' ? userId : null);
  const following = useFollowing(kind === 'following' ? userId : null);
  const query = kind === 'followers' ? followers : following;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[#141008] border border-white/10 rounded-xl p-5 max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg text-white font-serif italic">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-gray-500 hover:text-gray-300 cursor-pointer"
          >
            닫기
          </button>
        </div>
        <div className="overflow-y-auto flex-1 -mx-2 px-2">
          {query.isLoading && (
            <div className="py-6 text-center text-xs text-gray-500">
              불러오는 중…
            </div>
          )}
          {query.isError && (
            <div className="py-6 text-center text-xs text-red-400">
              목록을 불러오지 못했어요.
            </div>
          )}
          {query.data && query.data.users.length === 0 && (
            <DigmanEmpty
              message={
                kind === 'followers'
                  ? '아직 팔로워가 없어요.'
                  : '아직 팔로우한 디거가 없어요.'
              }
            />
          )}
          <div className="flex flex-col divide-y divide-white/5">
            {query.data?.users.map((u) => {
              const resolvedAvatar = resolveApiUrl(u.avatarUrl);
              const mydigHref = u.username ? `/my/${u.username}` : null;
              const nameInitial = (u.displayName || u.username || '?')
                .trim()
                .charAt(0)
                .toUpperCase();
              return (
                <div
                  key={u.id}
                  className="flex items-center gap-3 py-2.5"
                >
                  {mydigHref ? (
                    <Link
                      to={mydigHref}
                      onClick={onClose}
                      className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-80 transition-opacity"
                    >
                      <AvatarCell
                        avatar={resolvedAvatar}
                        initial={nameInitial}
                      />
                      <div className="min-w-0">
                        <div className="text-sm text-white truncate">
                          {u.displayName || u.username}
                        </div>
                        {u.username && (
                          <div className="text-[11px] text-gray-500 truncate">
                            @{u.username}
                          </div>
                        )}
                      </div>
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <AvatarCell
                        avatar={resolvedAvatar}
                        initial={nameInitial}
                      />
                      <div className="text-sm text-gray-400 truncate">
                        {u.displayName || '이름 없음'}
                      </div>
                    </div>
                  )}
                  <FollowButton
                    targetUserId={u.id}
                    following={u.followingByViewer}
                    size="sm"
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function AvatarCell({
  avatar,
  initial,
}: {
  avatar: string | null;
  initial: string;
}) {
  if (avatar) {
    return (
      <img
        src={avatar}
        alt=""
        className="w-10 h-10 rounded-full object-cover border border-white/10 shrink-0"
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div className="w-10 h-10 rounded-full bg-[#2a1f10] border border-white/10 shrink-0 flex items-center justify-center text-[#e8a020] font-semibold">
      {initial}
    </div>
  );
}
