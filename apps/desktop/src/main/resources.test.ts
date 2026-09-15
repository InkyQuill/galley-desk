import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  BOOK_RESOURCE_SCHEME,
  isHttpHttpsUrl,
  isSafeRelativeImagePath,
  parseBookResourceUrl,
  resolveBookImage,
} from './resources';

const tempDirs: string[] = [];

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'galley-res-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test('only http(s) URLs may go through shell.openExternal', () => {
  expect(isHttpHttpsUrl('https://example.net/page')).toBe(true);
  expect(isHttpHttpsUrl('http://example.net')).toBe(true);
  expect(isHttpHttpsUrl('file:///etc/passwd')).toBe(false);
  expect(isHttpHttpsUrl('javascript:alert(1)')).toBe(false);
  expect(isHttpHttpsUrl('data:text/html,x')).toBe(false);
  expect(isHttpHttpsUrl('//example.net')).toBe(false);
  expect(isHttpHttpsUrl('not a url')).toBe(false);
});

test('image targets must be plain relative paths inside the book', () => {
  expect(isSafeRelativeImagePath('img.png')).toBe(true);
  expect(isSafeRelativeImagePath('иллюстрации/рис 1.png')).toBe(true);
  expect(isSafeRelativeImagePath('../outside.png')).toBe(false);
  expect(isSafeRelativeImagePath('a/../../outside.png')).toBe(false);
  expect(isSafeRelativeImagePath('/etc/passwd')).toBe(false);
  expect(isSafeRelativeImagePath('file:///etc/passwd')).toBe(false);
  expect(isSafeRelativeImagePath('https://cdn.example/x.png')).toBe(false);
  expect(isSafeRelativeImagePath('javascript:alert(1)')).toBe(false);
  expect(isSafeRelativeImagePath('data:image/png;base64,xx')).toBe(false);
  expect(isSafeRelativeImagePath('//cdn.example/x.png')).toBe(false);
  expect(isSafeRelativeImagePath('sub\\win.png')).toBe(false);
  expect(isSafeRelativeImagePath('img.png?width=10')).toBe(false);
  expect(isSafeRelativeImagePath('img.png#page')).toBe(false);
  expect(isSafeRelativeImagePath('a%2F..%2F..%2Fetc')).toBe(false);
  expect(isSafeRelativeImagePath('')).toBe(false);
  expect(isSafeRelativeImagePath('chapter.md')).toBe(false);
});

test('parses bookres URLs into an opaque book id and a decoded relative path', () => {
  expect(parseBookResourceUrl(`bookres://id-1/%D0%B3%D0%BB%D0%B0%D0%B2%D0%B0/img.png`)).toEqual({
    bookId: 'id-1',
    relPath: 'глава/img.png',
  });
  expect(parseBookResourceUrl(`${BOOK_RESOURCE_SCHEME}://id-1/pic.png`)).toEqual({ bookId: 'id-1', relPath: 'pic.png' });
  expect(parseBookResourceUrl('https://example/x.png')).toBeNull();
  expect(parseBookResourceUrl('bookres:///no-host.png')).toBeNull();
  expect(parseBookResourceUrl('bookres://id-1')).toBeNull();
  expect(parseBookResourceUrl('bookres://id-1/%zz.png')).toBeNull();
  // WHATWG-парсер сам сворачивает %2e%2e в родительские сегменты ещё до нас;
  // защита от выхода наружу остаётся за проверкой контейнера в resolveBookImage.
  expect(parseBookResourceUrl('bookres://id-1/%2e%2e/secret.png')?.relPath).toBe('secret.png');
});

test('serves images only from inside the open root', async () => {
  const root = await tempRoot();
  await mkdir(path.join(root, 'иллюстрации'));
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  await writeFile(path.join(root, 'иллюстрации', 'рис.png'), png);
  await writeFile(path.join(root, 'note.txt'), 'не картинка');

  expect(await resolveBookImage(root, 'иллюстрации/рис.png')).toEqual({ mime: 'image/png', bytes: png });
  expect(await resolveBookImage(root, '../outside.png')).toBeNull();
  expect(await resolveBookImage(root, '/etc/passwd')).toBeNull();
  expect(await resolveBookImage(root, 'note.txt')).toBeNull();
  expect(await resolveBookImage(root, 'нет.png')).toBeNull();
  expect(await resolveBookImage(root, 'иллюстрации')).toBeNull();
});

test('rejects symlinks pointing outside the open root', async () => {
  const root = await tempRoot();
  const outside = await tempRoot();
  await writeFile(path.join(outside, 'secret.png'), 'секрет');
  await symlink(path.join(outside, 'secret.png'), path.join(root, 'out.png'));
  const insideTarget = path.join(root, 'inner.png');
  await writeFile(insideTarget, 'внутри');
  await symlink(insideTarget, path.join(root, 'in.png'));

  expect(await resolveBookImage(root, 'out.png')).toBeNull();
  // Ссылка на файл внутри корня остаётся разрешённой.
  expect(await resolveBookImage(root, 'in.png')).not.toBeNull();
});

test('rejects directory symlinks leading outside the open root', async () => {
  const root = await tempRoot();
  const outside = await tempRoot();
  await writeFile(path.join(outside, 'x.png'), 'секрет');

  // Промежуточный компонент — символьная ссылка на каталог снаружи:
  // lstat по такому пути возвращает regular file, утечка ловится только
  // через realpath всего пути.
  await symlink(outside, path.join(root, 'sub'));
  expect(await resolveBookImage(root, 'sub/x.png')).toBeNull();

  // Каталог-ссылка внутрь корня остаётся разрешённой.
  await mkdir(path.join(root, 'реальные'));
  await writeFile(path.join(root, 'реальные', 'ok.png'), 'внутри');
  await symlink(path.join(root, 'реальные'), path.join(root, 'внутренние'));
  expect((await resolveBookImage(root, 'внутренние/ok.png'))?.mime).toBe('image/png');
});

test('enforces the size cap', async () => {
  const root = await tempRoot();
  await writeFile(path.join(root, 'big.png'), Buffer.alloc(100, 1));
  expect(await resolveBookImage(root, 'big.png', { maxBytes: 10 })).toBeNull();
  expect(await resolveBookImage(root, 'big.png', { maxBytes: 1000 })).not.toBeNull();
});

test('root path is containment-checked even when crafted cleverly', async () => {
  const root = await tempRoot();
  await mkdir(path.join(root, 'sub'));
  await writeFile(path.join(root, 'sub', 'a.png'), 'x');
  const realRoot = await realpath(root);
  expect((await resolveBookImage(realRoot, 'sub/../sub/a.png'))?.mime).toBe('image/png');
  expect(await resolveBookImage(realRoot, 'sub/../../etc/passwd')).toBeNull();
});
