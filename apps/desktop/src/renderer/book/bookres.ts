// Локальные картинки главы: только относительные пути внутри книги
// превращаются в ссылки защищённой схемы bookres (resources.ts в main).
// Схемы, абсолютные пути и обход каталогов отвергаются до сборки URL.

// Изображение в текущем виде — только локальный относительный путь: схемы,
// абсолютные пути и обход каталогов не превращаются в bookres-ссылки.
const IMAGE_PATTERN = /!\[[^\]]*\]\(([^()\s]+)\)/g;
const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export function isLocalImagePath(target: string): boolean {
  if (target.length === 0) return false;
  if (SCHEME_PATTERN.test(target)) return false;
  if (target.startsWith('/') || target.startsWith('\\') || target.includes('\\')) return false;
  if (target.startsWith('//')) return false;
  if (target.includes('?') || target.includes('#')) return false;
  const segments = target.split('/');
  if (segments.includes('..') || segments.includes('')) return false;
  return true;
}

export function bookResourceUrl(bookId: string, target: string): string {
  const encoded = target.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return `${'bookres:'}//${bookId}/${encoded}`;
}

// Внешняя ссылка: во внешний браузер уходит только http(s) (зеркало правила
// isHttpHttpsUrl в main/resources.ts — фильтр desk:open-external страхует).
export function isHttpHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
