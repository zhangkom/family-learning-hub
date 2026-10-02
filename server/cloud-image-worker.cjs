/* eslint-disable typescript/no-require-imports -- Fixed isolated CommonJS worker. */
'use strict';
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (part) => {
  input += part;
  if (input.length > 8192) process.exit(2);
});
process.stdin.on('end', async () => {
  try {
    const { path, sharpPath, mimeType } = JSON.parse(input);
    // The fixed CommonJS child receives the parent's runtime-resolved module.
    // eslint-disable-next-line typescript/no-require-imports
    const sharp = require(sharpPath);
    // libvips on Windows cannot open every long workspace path that Node can.
    // eslint-disable-next-line typescript/no-require-imports
    const imageInput =
      process.platform === 'win32'
        ? require('node:fs').readFileSync(path)
        : path;
    sharp.cache(false);
    sharp.concurrency(1);
    const metadata = await sharp(imageInput, {
      limitInputPixels: 32_000_000,
      failOn: 'warning',
    }).metadata();
    if (
      { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[
        metadata.format
      ] !== mimeType ||
      (metadata.pages || 1) !== 1 ||
      !metadata.width ||
      !metadata.height
    )
      throw new Error('Invalid image');
    const thumbnail = await sharp(imageInput, {
      limitInputPixels: 32_000_000,
      failOn: 'warning',
      sequentialRead: true,
    })
      .rotate()
      .resize({
        width: 640,
        height: 640,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#fff' })
      .jpeg({ quality: 78 })
      .toBuffer();
    const orientation = metadata.orientation || 1;
    if (orientation < 1 || orientation > 8)
      throw new Error('Invalid orientation');
    process.stdout.write(
      JSON.stringify({
        width: orientation >= 5 ? metadata.height : metadata.width,
        height: orientation >= 5 ? metadata.width : metadata.height,
        orientation,
        thumbnail: thumbnail.toString('base64'),
      }),
    );
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        error: /pixel limit/i.test(String(error.message))
          ? 'PIXEL_LIMIT'
          : 'INVALID_IMAGE',
      }),
    );
  }
});
