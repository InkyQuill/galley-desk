import { expect, test } from 'vitest';
import { derivedRangeToDisplayRange, findLiteral } from './search';
import type { ComparisonSegment } from './search';
test('finds literal markdown positions after emoji', () => {
  expect(findLiteral('🙂 кот кот','кот')).toEqual([{from:3,to:6},{from:7,to:10}]);
  expect(findLiteral('кот','')).toEqual([]);
});

test('findLiteral respects overlapping-free sequential scanning', () => {
  // «ага» в «агага»: совпадения не перекрываются (шаг на длину запроса).
  expect(findLiteral('агага', 'ага')).toEqual([{ from: 0, to: 3 }]);
  expect(findLiteral('кот', 'коты')).toEqual([]);
});

test('maps derived range through explicit comparison segment coordinates', () => {
  // display: 'кот '(0..4) + 'sleeps'(4..10) + 'спит!'(10..14) + ' ещё'(14..18);
  // производный текст: 'кот спит ещё' (правка применена в derived [4..8)).
  const segments: ComparisonSegment[] = [
    { kind: 'text', derivedFrom: 0, derivedTo: 4, displayStart: 0 },
    { kind: 'edit', derivedFrom: 4, derivedTo: 8, displayStart: 4, beforeLength: 6 },
    { kind: 'text', derivedFrom: 8, derivedTo: 12, displayStart: 14 },
  ];
  // Чистый текст: display совпадает с derived.
  expect(derivedRangeToDisplayRange(segments, 0, 3)).toEqual({ from: 0, to: 3 });
  // Введённая часть правки: сдвиг на длину before.
  expect(derivedRangeToDisplayRange(segments, 5, 8)).toEqual({ from: 11, to: 14 });
  // Начало правки указывает на введённую часть, не на удалённую.
  expect(derivedRangeToDisplayRange(segments, 4, 5)).toEqual({ from: 10, to: 11 });
  // Стык кусков принадлежит следующему текстовому куску.
  expect(derivedRangeToDisplayRange(segments, 8, 10)).toEqual({ from: 14, to: 16 });
  expect(derivedRangeToDisplayRange(segments, 10, 12)).toEqual({ from: 16, to: 18 });
  // Пустой и вырожденные диапазоны.
  expect(derivedRangeToDisplayRange(segments, 0, 0)).toEqual({ from: 0, to: 0 });
  // Вне документа и без сегментов — перехода нет.
  expect(derivedRangeToDisplayRange(segments, 0, 13)).toEqual(null);
  expect(derivedRangeToDisplayRange([], 0, 1)).toEqual(null);
});
