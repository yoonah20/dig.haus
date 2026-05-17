import { useState } from 'react';

// URL share button. Default behaviour: copy `url` to clipboard, flash
// "복사됨" for feedback. When `imageUrl` is also provided AND we're on
// a coarse-pointer device with Web Share API + file support (mobile
// Safari/Chrome), the click instead opens the OS share sheet with
// the PNG as a File payload — so the visitor can post to Instagram,
// save to camera roll, send via KakaoTalk, etc. Falls through to the
// clipboard copy on desktop / no-share-support.

interface Props {
  // URL the visitor sees / receives. Mobile share sheet uses it as
  // the fallback `url` field; desktop just copies it to clipboard.
  url: string;
  label?: string;
  // Optional PNG endpoint. When set, mobile devices that support
  // Web Share API with files fetch this URL into a File and open
  // the share sheet with it. When absent or unsupported, ShareButton
  // behaves like the plain URL-copy version.
  imageUrl?: string;
  // Filename hint passed to the Web Share API for the File payload.
  imageFilename?: string;
}

export default function ShareButton({
  url,
  label = '공유',
  imageUrl,
  imageFilename,
}: Props) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      try {
        window.prompt('URL 복사:', url);
      } catch {
        /* swallow */
      }
    }
  };

  const handleClick = async () => {
    if (!url && !imageUrl) return;
    // Mobile file-share branch — same gate ToasterButton uses.
    // canShare with files is the "the OS sheet supports our file
    // payload" check; if it rejects we fall through to URL copy
    // so the visitor at least gets a clipboard URL.
    if (
      imageUrl &&
      typeof navigator !== 'undefined' &&
      typeof navigator.canShare === 'function' &&
      typeof window !== 'undefined' &&
      window.matchMedia?.('(pointer: coarse)').matches
    ) {
      try {
        const res = await fetch(imageUrl);
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        const blob = await res.blob();
        const file = new File([blob], imageFilename || 'share.png', {
          type: blob.type || 'image/png',
        });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], url });
          return;
        }
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        // canShare or share rejected — fall through to clipboard.
      }
    }
    await copyToClipboard();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="text-[11px] text-gray-200 hover:text-accent bg-background/40 border border-white/10 hover:border-accent/50 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
      title={url || '링크 없음'}
    >
      {copied ? (
        '✓ 복사됨'
      ) : (
        <>
          <span className="hidden md:inline">🔗 </span>
          {label}
        </>
      )}
    </button>
  );
}
