// main/tools/module/archive.test.ts
import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { createDeterministicTarGz, extractTarGzToMemory, sha256Hex } from './archive';

function craftRawUstarArchive(params: {
  readonly name: string;
  readonly typeflag?: string;
  readonly content?: Buffer;
  readonly corruptChecksum?: boolean;
}): Buffer {
  const header = Buffer.alloc(512, 0);
  const content = params.content ?? Buffer.alloc(0);
  header.write(params.name, 0, Math.min(100, Buffer.byteLength(params.name)), 'utf8');
  header.write('0000644\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(`${content.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  header.write('00000000000\0', 136, 12, 'ascii');
  header.fill(0x20, 148, 156);
  header.write(params.typeflag ?? '0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');

  let sum = 0;
  for (let i = 0; i < 512; i += 1) {
    sum += header[i] ?? 0;
  }
  if (params.corruptChecksum === true) {
    sum += 17;
  }
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');

  const padLen = (512 - (content.length % 512)) % 512;
  const trailer = Buffer.alloc(1024, 0);
  return gzipSync(Buffer.concat([header, content, Buffer.alloc(padLen, 0), trailer]));
}

describe('module deterministic tar.gz archive codec', () => {
  it('rejects archive extraction when expectedSha256 does not match', () => {
    const archive = createDeterministicTarGz([
      { path: 'module.ts', content: Buffer.from('export const x = 1;\n') },
    ]);

    expect(() =>
      extractTarGzToMemory(archive, {
        expectedSha256: '0'.repeat(64),
      }),
    ).toThrow(/sha-?256 checksum mismatch/iu);
  });

  it('rejects unsafe traversal, absolute, backslash, and .git archive entry paths on extract', () => {
    for (const badName of [
      '../escape.ts',
      '/etc/passwd',
      'sub/../../escape.ts',
      'a\\b.ts',
      '.git/config',
    ]) {
      const crafted = craftRawUstarArchive({
        name: badName,
        content: Buffer.from('pwn'),
      });
      expect(() => extractTarGzToMemory(crafted), badName).toThrow(/unsafe archive path/iu);
    }
  });

  it('rejects symlink, hardlink, and device entries inside tar archives', () => {
    for (const typeflag of ['1', '2', '3', '4', '6']) {
      const crafted = craftRawUstarArchive({
        name: 'evil-link',
        typeflag,
      });
      expect(() => extractTarGzToMemory(crafted), `typeflag=${typeflag}`).toThrow(
        /unsupported tar entry type/iu,
      );
    }
  });

  it('rejects corrupted tar header checksums and oversized uncompressed payloads', () => {
    const badChecksum = craftRawUstarArchive({
      name: 'module.ts',
      content: Buffer.from('ok'),
      corruptChecksum: true,
    });
    expect(() => extractTarGzToMemory(badChecksum)).toThrow(/checksum/iu);

    const bigPayload = createDeterministicTarGz([
      { path: 'big.bin', content: Buffer.alloc(4096, 0x41) },
    ]);
    expect(() => extractTarGzToMemory(bigPayload, { maxUncompressedBytes: 1024 })).toThrow(
      /exceeds|max/iu,
    );
  });

  it('rejects unsafe or empty paths when creating an archive', () => {
    expect(() =>
      createDeterministicTarGz([{ path: '../outside.ts', content: Buffer.from('x') }]),
    ).toThrow(/unsafe archive path/iu);
    expect(() => createDeterministicTarGz([{ path: '', content: Buffer.from('x') }])).toThrow(
      /unsafe archive path/iu,
    );
  });

  it('produces byte-identical deterministic archives regardless of input order and round-trips long UStar paths', () => {
    const longNestedPath = `${'nested-segment/'.repeat(8)}deeply-nested-component.real-db.test.tsx`;
    expect(longNestedPath.length).toBeGreaterThan(110);

    const archiveA = createDeterministicTarGz([
      { path: longNestedPath, content: Buffer.from('export const deep = true;\n') },
      { path: 'empty.txt', content: Buffer.alloc(0) },
      { path: 'module.ts', content: Buffer.from('export const mod = 1;\n') },
    ]);
    const archiveB = createDeterministicTarGz([
      { path: 'module.ts', content: Buffer.from('export const mod = 1;\n') },
      { path: longNestedPath, content: Buffer.from('export const deep = true;\n') },
      { path: 'empty.txt', content: Buffer.alloc(0) },
    ]);

    expect(Buffer.compare(archiveA, archiveB)).toBe(0);

    const extracted = extractTarGzToMemory(archiveA, {
      expectedSha256: sha256Hex(archiveA),
    });
    expect([...extracted.keys()]).toEqual(['empty.txt', 'module.ts', longNestedPath]);
    expect(extracted.get('empty.txt')?.length).toBe(0);
    expect(extracted.get(longNestedPath)?.toString('utf8')).toBe('export const deep = true;\n');
  });
});
