import type { Request, Response, NextFunction } from 'express';
import type { AppUser } from '../auth/passport.js';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: '입장하기(로그인)가 필요합니다' });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = req.user as AppUser | undefined;
  if (!user) {
    res.status(401).json({ error: '입장하기(로그인)가 필요합니다' });
    return;
  }
  if (!user.is_admin) {
    res.status(403).json({ error: '관리자 권한이 필요합니다' });
    return;
  }
  next();
}
