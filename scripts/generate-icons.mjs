// Rebuild app icons from Penny's accepted carried frame. No sprite pixels are changed.
import fs from 'node:fs';
import zlib from 'node:zlib';
import ts from 'typescript';
const source = ts.transpileModule(fs.readFileSync(new URL('../src/lib/sprite.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { ANIMS, PALETTE } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
// Portrait: original rounded ears, white face, grey marking and pink nose.
const rows = ANIMS[1].carried.frames[0].slice(3, 14).map((r, y) => {
  const row = [...r.slice(9, 23)];
  // Remove only the scruff above the face when isolating the portrait.
  if (y < 2) row.fill('.', 5, 9);
  return row.join('');
});
const crc32 = bytes => {
  let crc = 0xffffffff;
  for (const b of bytes) { crc ^= b; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, crc]);
};
function png(size) {
  const scale = Math.max(1, Math.floor(size / 16));
  const ox = Math.floor((size - 14 * scale) / 2), oy = Math.floor((size - 11 * scale) / 2);
  const data = Buffer.alloc(size * (size * 4 + 1));
  rows.forEach((row, y) => [...row].forEach((key, x) => {
    if (key === '.') return;
    const color = PALETTE[key].slice(1).match(/../g).map(v => parseInt(v, 16));
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const at = (oy + y * scale + dy) * (size * 4 + 1) + 1 + (ox + x * scale + dx) * 4;
      data.set([...color, 255], at);
    }
  }));
  const hdr = Buffer.alloc(13); hdr.writeUInt32BE(size); hdr.writeUInt32BE(size, 4); hdr[8] = 8; hdr[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', hdr), chunk('IDAT', zlib.deflateSync(data)), chunk('IEND', Buffer.alloc(0))]);
}
const out = new URL('../src-tauri/icons/', import.meta.url);
for (const [name, size] of Object.entries({ '32x32.png':32, '128x128.png':128, '128x128@2x.png':256, 'icon.png':512 })) fs.writeFileSync(new URL(name, out), png(size));
const sizes = [16, 24, 32, 48, 64, 128, 256], images = sizes.map(png);
const hdr = Buffer.alloc(6 + 16 * sizes.length); hdr.writeUInt16LE(1, 2); hdr.writeUInt16LE(sizes.length, 4);
let offset = hdr.length;
sizes.forEach((size, i) => {
  const at = 6 + 16*i; hdr[at] = hdr[at+1] = size === 256 ? 0 : size;
  hdr.writeUInt16LE(1, at+4); hdr.writeUInt16LE(32, at+6); hdr.writeUInt32LE(images[i].length, at+8); hdr.writeUInt32LE(offset, at+12); offset += images[i].length;
});
fs.writeFileSync(new URL('icon.ico', out), Buffer.concat([hdr, ...images]));
console.log('Penny PNG/ICO icons generated.');
