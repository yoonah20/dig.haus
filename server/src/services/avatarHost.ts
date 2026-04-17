import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

// Resolved from this module's location rather than process.cwd() so the
// path is stable regardless of how the server is launched. Compiled file
// lives at <app>/server/dist/services/ → ../../data lands on
// <app>/server/data, which is where the Railway Volume is mounted. The
// cwd-based version broke in production because Railway's startCommand
// launched node from /app, so writes landed in /app/data (ephemeral,
// wiped on every deploy) while the volume at /app/server/data sat empty
// — every redeploy silently dropped users' uploaded avatars.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const AVATARS_DIR = path.resolve(__dirname, '..', '..', 'data', 'avatars');
fs.mkdirSync(AVATARS_DIR, { recursive: true });

export const AVATARS_ROUTE = '/api/avatars';

const TARGET_SIZE = 200;
const HOST_VERSION = 1;

export class AvatarError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'AvatarError';
  }
}

/**
 * Resize an uploaded avatar buffer to 200×200 WebP and persist under
 * server/data/avatars/. Filename is hashed off the user id + content so
 * repeat uploads of the same file reuse the same path.
 */
export async function hostAvatarFromBuffer(
  userId: number,
  input: Buffer
): Promise<string> {
  let buffer: Buffer;
  try {
    buffer = await sharp(input)
      .resize(TARGET_SIZE, TARGET_SIZE, {
        fit: 'cover',
        position: 'center',
        kernel: 'lanczos3',
      })
      .webp({ quality: 85 })
      .toBuffer();
  } catch (err) {
    throw new AvatarError(400, `이미지 처리 실패: ${(err as Error).message}`);
  }

  // Mix userId + content hash so two users uploading the same image still
  // land on distinct files, and re-uploading the same image doesn't
  // overwrite an in-use file with itself.
  const contentHash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 16);
  const filename = `u${userId}-v${HOST_VERSION}-${contentHash}.webp`;
  const filePath = path.join(AVATARS_DIR, filename);
  const publicUrl = `${AVATARS_ROUTE}/${filename}`;

  if (!fs.existsSync(filePath)) {
    await fs.promises.writeFile(filePath, buffer);
  }
  return publicUrl;
}
