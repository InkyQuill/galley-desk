export type SearchRange = { from: number; to: number };

/** Точная подстрока, без регулярных выражений — совпадения не пересекаются
 * (после найденного совпадения поиск продолжается сразу за ним). */
export function findLiteral(text: string, query: string): SearchRange[] {
  if (query === '') return [];
  const ranges: SearchRange[] = [];
  let index = text.indexOf(query);
  while (index !== -1) {
    ranges.push({ from: index, to: index + query.length });
    index = text.indexOf(query, index + query.length);
  }
  return ranges;
}
