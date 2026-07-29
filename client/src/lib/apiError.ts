// Build a user-facing error string that surfaces WHAT actually failed
// instead of a fixed guess. Prefers the server's own {error} body; when
// that body never arrived — a gateway 5xx page with no CORS headers, a
// timeout, or a dropped connection all strip it, leaving axios with no
// response.data — it falls back to the HTTP status or a network hint plus
// the underlying axios message. That way an otherwise opaque failure is
// diagnosable straight from the alert, without opening devtools.
export function apiErrorMessage(err: any, action: string): string {
  const serverMsg = err?.response?.data?.error;
  if (typeof serverMsg === 'string' && serverMsg) return serverMsg;
  const status = err?.response?.status;
  const detail = err?.message ? ` (${err.message})` : '';
  if (status) return `${action}에 실패했습니다. 서버 오류 HTTP ${status}${detail}`;
  return `${action}에 실패했습니다. 서버 응답 없음 — 네트워크 오류 또는 타임아웃${detail}`;
}
