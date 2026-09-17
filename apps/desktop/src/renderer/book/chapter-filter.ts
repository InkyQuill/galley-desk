import type { Entry } from '../../shared/api';

/**
 * Фильтр оглавления (история №9 UX-ревью): совпадение по названию ИЛИ пути
 * главы, без учёта регистра (локаль ru — корректно для кириллицы) и краевых
 * пробелов запроса. Пустой/пробельный запрос совпадает с любой главой.
 * `_index.md` не исключается — состав оглавления определяет автор, не этот
 * helper. Манифест не меняется: helper только решает видимость в списке.
 */
export function matchesChapter(entry: Pick<Entry, 'title' | 'path'>, query: string): boolean {
  const key = query.trim().toLocaleLowerCase('ru');
  return [entry.title, entry.path].some((value) => value.toLocaleLowerCase('ru').includes(key));
}
