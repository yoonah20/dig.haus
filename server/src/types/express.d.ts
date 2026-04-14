import type { AppUser } from '../auth/passport.js';

declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface User extends AppUser {}
  }
}

export {};
