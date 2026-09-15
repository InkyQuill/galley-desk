# Pocket Editor: tolerant reviews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Читать и сохранять висящие/конфликтующие записи без отказа всей рецензии.

**Architecture:** Структурный codec не решает доступность записи. Общий классификатор разрешает anchors на текущем исходнике и исключает все пересекающиеся активные правки; UI показывает сохранённые записи.

**Tech Stack:** Kotlin, kotlinx.serialization, JUnit 5, Compose, Gradle/JDK 17

**Spec:** [/home/inky/Development/galley-desk/docs/superpowers/specs/2026-09-15-galley-desk-design.md](/home/inky/Development/galley-desk/docs/superpowers/specs/2026-09-15-galley-desk-design.md) — прочитать вместе с CONTEXT.md и ADR перед выполнением.

## Global Constraints

- Основные платформы: Linux и macOS.
- Обычный ввод создаёт правки в sidecar; исходный Markdown не меняется.
- Схемы v1 не расширяются дополнительными полями Galley Desk.
- Пересечение сохранённых диапазонов не является причиной отвергать весь sidecar при чтении или записи.
- Сигналы могут пересекаться.
- Закрытие книги/проекта очищает оба стека всех глав.
- Renderer работает с включённой изоляцией контекста, без Node integration.
- В рамках реализации разрешены необходимые изменения Galley Editor, Galley Pad и Pocket Editor; существующее поведение этих проектов не является неизменяемым ограничением.
- Правка / сигнал — термины интерфейса; не «предложение». Исходный Markdown сохраняет точные UTF-8 bytes и переводы строк.
- На время выполнения проверить AGENTS.md соответствующего репозитория и рабочее дерево. Существующие изменения других агентов/пользователя не отменять. Изолированный worktree создавать только при выполнении плана.
- Тестовые фрагменты ниже — начальные исполняемые регрессии, алгоритмы — конкретные опорные участки; остальные перечисленные примеры добавлять отдельными короткими циклами RED/GREEN. Не считать один пример полной проверкой задачи.

---

## Корень и карта файлов

Корень: `/home/inky/Development/pocket-editor`. Все пути ниже относительно него.

- `review/ReviewJson.kt` — только структурная валидация и canonical encoding.
- Новый `review/ReviewAvailability.kt` — разрешение и классификация записей; не зависит от Compose.
- `review/EditValidator.kt` — проверка новой мутации против активных диапазонов.
- `reader/ReviewProjector.kt` — проецирует только активные правки.
- Новый `ui/review/UnavailableReviewCard.kt` — причина, исходный текст, удаление.
- Новый контрактный `contracts/DesktopExchangeTest.kt` — файловый обмен fixtures с TypeScript.

Префикс production-путей: `app/src/main/java/net/inkyquill/pocketeditor/`; тестов: `app/src/test/java/net/inkyquill/pocketeditor/`. В Files пути указаны полностью. Структура JSON v1 не меняется. План самостоятельно заканчивается рабочим Android-приложением.

### Task P1: Разделить чтение JSON и разрешение диапазонов

**Files:**
- Modify: `app/src/main/java/net/inkyquill/pocketeditor/review/ReviewJson.kt`
- Create: `app/src/main/java/net/inkyquill/pocketeditor/review/ReviewAvailability.kt`
- Test: `app/src/test/java/net/inkyquill/pocketeditor/review/ReviewJsonTest.kt`
- Create/Test: `app/src/test/java/net/inkyquill/pocketeditor/review/ReviewAvailabilityTest.kt`
- Modify: `schemas/README.md`, `docs/architecture.md`

**Interfaces:**
- Consumes: existing `ReviewDocument`, `Edit`, `Signal`, `AnchorResolver.resolve(source: ByteArray, anchor: Anchor, selectedText: String): AnchorResolution`.
- Produces: `data class ReviewAvailability(val activeEdits: Map<String, Resolved>, val activeSignals: Map<String, Resolved>, val unavailable: Map<String, AnchorResolution>, val conflictingEdits: Set<String>)`; `fun classifyReview(source: ByteArray, review: ReviewDocument): ReviewAvailability`. Conflicting — отдельный статус, не новый вариант AnchorResolution.

- [ ] **Step 1: Зафиксировать регрессию**

В существующем ReviewJsonTest используются уже определённые `edit`, `chapterId`, `sourcePath`:
```kotlin
@Test
fun preservesOverlappingStoredRanges() {
    val first = edit("11111111-1111-4111-8111-111111111111", 0, 4)
    val second = edit("22222222-2222-4222-8222-222222222222", 2, 6)
    val document = ReviewDocument(chapterId = chapterId, sourcePath = sourcePath,
        edits = listOf(first, second))
    assertEquals(document, ReviewJson.decode(ReviewJson.encode(document), chapterId, sourcePath))
}
```
Заменить старый тест отказа только на пересечении; не удалять проверки duplicate UUID, before==after, версии, структуры и путей.

- [ ] **Step 2: Проверить RED**

Run: `./gradlew testDebugUnitTest --tests '*ReviewJsonTest' --tests '*ReviewAvailabilityTest'`
Expected: тест падает на описанном несовпадении поведения или отсутствующем новом экспорте; ошибка установки окружения не считается RED.

- [ ] **Step 3: Реализовать контракт минимальными шагами**

Удалить только `.sortedBy ... zipWithNext` проверку пересечений из codec. Классификатор сначала вызывает AnchorResolver отдельно для каждой записи; активными сигналами становятся Resolved, для правок после разрешения найти всех участников пересечения:
```kotlin
val conflicting = mutableSetOf<String>()
val resolved = editLocations.entries.toList() // Map<String, Resolved> после resolve
for (i in resolved.indices) {
    for (j in i + 1 until resolved.size) {
        val a = resolved[i]; val b = resolved[j]
        if (a.value.startByte < b.value.endByte && b.value.startByte < a.value.endByte) {
            conflicting += a.key
            conflicting += b.key
        }
    }
}
```
Объявить `editLocations` локальным `linkedMapOf<String, Resolved>()`, заполненным результатами resolve для `edit.before`. `unavailable` получает Stale/Ambiguous. В `activeEdits` вернуть `editLocations.filterKeys { it !in conflicting }`. Порядок массива не должен менять результат.

- [ ] **Step 4: Проверить GREEN и закончить сценарий**

Run: `./gradlew testDebugUnitTest --tests '*ReviewJsonTest' --tests '*ReviewAvailabilityTest'`
Expected: PASS.

- [ ] Добавить отдельные примеры A∩B, B∩C без A∩C: конфликтуют все три; смежные диапазоны не конфликтуют; сигналы пересекаются свободно.
- [ ] Проверить одинаковые старые offsets с разными source hashes, которые разрешаются в непересекающиеся новые места.
- [ ] Проверить сохранение before/after/comment и UUID недоступных записей при изменении chapter_note.
- [ ] Обновить schemas/README: JSON Schema неизменна, Kotlin больше не отвергает сохранённые пересечения.

- [ ] **Step 5: Зафиксировать завершённую задачу**

Из корня указанного репозитория добавить только перечисленные файлы этой задачи (и необходимый lockfile), проверить `git diff --cached --check`, затем:

```bash
git commit -m "fix(review): preserve unavailable and overlapping records"
```

### Task P2: Подключить классификатор к мутациям, проекции и merge

**Files:**
- Modify: `app/src/main/java/net/inkyquill/pocketeditor/review/EditValidator.kt`
- Modify: `app/src/main/java/net/inkyquill/pocketeditor/reader/ReviewProjector.kt`
- Modify: `app/src/main/java/net/inkyquill/pocketeditor/reader/ReaderRepository.kt`
- Test: `app/src/test/java/net/inkyquill/pocketeditor/review/EditValidatorTest.kt`
- Test: `app/src/test/java/net/inkyquill/pocketeditor/reader/ReviewProjectorTest.kt`
- Test: `app/src/test/java/net/inkyquill/pocketeditor/merge/ReviewMergeTest.kt`

**Interfaces:**
- Consumes: P1 `classifyReview` and existing `EditValidator.validate(edit: Edit, existing: List<Edit>, source: ByteArray)`.
- Produces: existing validator signature unchanged; `ReaderDocument` adds `conflictingEditIds: Set<String> = emptySet()`. Existing unresolved list retains Stale/Ambiguous; no arbitrary first-wins projection.

- [ ] **Step 1: Зафиксировать регрессию**

Добавить в EditValidatorTest (импорты AnchorFactory и assertDoesNotThrow):
```kotlin
@Test
fun unavailableRecordDoesNotReserveItsOldOffset() {
    val source = "новое".encodeToByteArray()
    val gone = "старое".encodeToByteArray()
    val old = Edit("11111111-1111-4111-8111-111111111111", "старое", "было",
        AnchorFactory.create(gone, 0, gone.size))
    val fresh = Edit("22222222-2222-4222-8222-222222222222", "новое", "стало",
        AnchorFactory.create(source, 0, source.size))
    assertDoesNotThrow { EditValidator.validate(fresh, listOf(old), source) }
}
```

- [ ] **Step 2: Проверить RED**

Run: `./gradlew testDebugUnitTest --tests '*EditValidatorTest' --tests '*ReviewProjectorTest' --tests '*ReviewMergeTest'`
Expected: тест падает на описанном несовпадении поведения или отсутствующем новом экспорте; ошибка установки окружения не считается RED.

- [ ] **Step 3: Реализовать контракт минимальными шагами**

Сохранить все проверки байтов/хешей самого кандидата. Классифицировать existing без кандидата; сравнивать кандидат только с activeEdits текущего source:
```kotlin
val existingDocument = ReviewDocument(
    chapterId = "00000000-0000-4000-8000-000000000000",
    sourcePath = "validation.md", edits = existing.filterNot { it.id == edit.id })
val active = classifyReview(source, existingDocument).activeEdits.values
require(active.none { edit.anchor.startByte < it.endByte && it.startByte < edit.anchor.endByte }) {
    "Edit source ranges must not overlap active edits"
}
```
Projector вызывает classifyReview один раз до разбиения на Markdown-блоки. Из activeEdits строит существующие ActiveEdit; conflictingEditIds передаёт отдельно; anchors вне отображаемых блоков остаются доступны из списка как недоступные. Существующий multi-block projection не заменять одноблочной реализацией. Merge сохраняет разные UUID даже при пересечении, а конфликты разных версий одной UUID продолжает обрабатывать прежним механизмом.

- [ ] **Step 4: Проверить GREEN и закончить сценарий**

Run: `./gradlew testDebugUnitTest --tests '*EditValidatorTest' --tests '*ReviewProjectorTest' --tests '*ReviewMergeTest'`
Expected: PASS.

- [ ] Проверить активный конфликт и одну независимую правку: независимая отображается, конфликтующие нет.
- [ ] Удаление участника пересечения повторно классифицирует оставшиеся записи.
- [ ] Обновление заметки и сохранение/синхронизация не удаляют unavailable records.
- [ ] Найти все вызовы EditValidator через `rg 'EditValidator.validate' app/src/main`; проверить существующие сценарии ReaderRepositoryTest.

- [ ] **Step 5: Зафиксировать завершённую задачу**

Из корня указанного репозитория добавить только перечисленные файлы этой задачи (и необходимый lockfile), проверить `git diff --cached --check`, затем:

```bash
git commit -m "fix(reader): classify review availability before projection"
```

### Task P3: Карточки недоступных записей без мобильной перепривязки

**Files:**
- Create: `app/src/main/java/net/inkyquill/pocketeditor/ui/review/UnavailableReviewCard.kt`
- Modify: `app/src/main/java/net/inkyquill/pocketeditor/ui/reader/ReaderScreen.kt`
- Modify: `app/src/main/java/net/inkyquill/pocketeditor/ui/review/EditorialReviewCallbacks.kt`
- Modify: `app/src/main/java/net/inkyquill/pocketeditor/ui/review/EditorialReviewController.kt`
- Modify: `app/src/main/res/values/strings.xml`
- Create/Test: `app/src/androidTest/java/net/inkyquill/pocketeditor/ui/review/UnavailableReviewCardTest.kt`
- Modify: `docs/user-guide.md`

**Interfaces:**
- Consumes: P2 `ReaderDocument.conflictingEditIds`, existing unresolved entries, review records, existing onDeleteEdit/onDeleteSignal callbacks.
- Produces: `@Composable fun UnavailableReviewCard(label: String, savedText: String, reason: String, onDelete: () -> Unit)`; no onReanchor button or exposed manual rebind workflow.

- [ ] **Step 1: Зафиксировать регрессию**

Compose instrumentation test:
```kotlin
@Test fun readsAndDeletesWithoutRebinding() {
    var deleted = false
    composeRule.setContent {
        UnavailableReviewCard("Правка", "старый текст → новый текст", "Привязка недоступна") {
            deleted = true
        }
    }
    composeRule.onNodeWithText("старый текст → новый текст").assertIsDisplayed()
    composeRule.onNodeWithText("Перепривязать").assertDoesNotExist()
    composeRule.onNodeWithText("Удалить").performClick()
    assertTrue(deleted)
}
```
Объявить `@get:Rule val composeRule = createComposeRule()` в новом классе, использовать существующий Android-test runner.

- [ ] **Step 2: Проверить RED**

Run: `./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=net.inkyquill.pocketeditor.ui.review.UnavailableReviewCardTest`
Expected: тест падает на описанном несовпадении поведения или отсутствующем новом экспорте; ошибка установки окружения не считается RED.

- [ ] **Step 3: Реализовать контракт минимальными шагами**

Компонент не зависит от resolver:
```kotlin
Column {
    Text(label)
    Text(reason)
    Text(savedText)
    TextButton(onClick = onDelete) { Text(stringResource(R.string.delete)) }
}
```
Проверить существующий ресурс delete; если отсутствует, добавить `review_delete_record` и использовать его. В ReaderScreen заменить цикл unresolved с onReanchor на карточки. Для сигнала показывать selected_text + comment, для правки before + after; conflicting ids получают причину «Правки пересекаются». Удаление использует существующую сериализованную очередь событий. Удалить onReanchor из UI callbacks и недостижимый beginReanchor UI-путь, скорректировать связанные unit-тесты; не удалять низкоуровневые функции, пока остаются реальные потребители.

- [ ] **Step 4: Проверить GREEN и закончить сценарий**

Run: `./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=net.inkyquill.pocketeditor.ui.review.UnavailableReviewCardTest`
Expected: PASS.

- [ ] Проверить удаление одного участника конфликта и появление оставшейся активной правки.
- [ ] Запустить `./gradlew test lint assembleDebug compileDebugAndroidTestKotlin`.
- [ ] Instrumentation реально выполнить на эмуляторе; компиляция без запуска не считается UI-проверкой.
- [ ] В руководстве описать обновлённую совместимость, карточки и отсутствие перепривязки.

- [ ] **Step 5: Зафиксировать завершённую задачу**

Из корня указанного репозитория добавить только перечисленные файлы этой задачи (и необходимый lockfile), проверить `git diff --cached --check`, затем:

```bash
git commit -m "feat(review): show unavailable records without rebinding"
```

### Task P4: Файловый Kotlin-мост для межъязыковых контрактов

**Files:**
- Create/Test: `app/src/test/java/net/inkyquill/pocketeditor/contracts/DesktopExchangeTest.kt`
- Create: `app/src/test/resources/fixtures/desktop-exchange.json`
- Modify: `docs/testing.md`

**Interfaces:**
- Consumes: P1 classifier, ReviewJson, AnchorFactory, AnchorResolver, BookDiscovery/ChapterTitleExtractor.
- Produces: JUnit test reads optional env `GALLEY_EXCHANGE_DIR`; input `input.json`, output `output.json`. Input shape: `{cases:[{name,source,review}]}`; output `{cases:[{name,review,activeEditIds,conflictingEditIds,unavailableIds}]}`. source — exact Unicode string, review — JSON object. Missing env runs bundled fixtures instead of skipping.

- [ ] **Step 1: Зафиксировать регрессию**

Встроенный тест проверяет сохранение пересекающихся диапазонов через настоящий codec:
```kotlin
val input = javaClass.getResource("/fixtures/desktop-exchange.json")!!.readText()
val root = Json.parseToJsonElement(input).jsonObject
assertTrue(root.getValue("cases").jsonArray.isNotEmpty())
```
Fixture содержит минимум исходник `abcdef`, две валидные правки `[0,3)` и `[2,5)` и один сигнал. Генерировать anchors через AnchorFactory в тестовой подготовке, а зафиксированный fixture сравнить с повторной генерацией, не писать фиктивные хеши.

- [ ] **Step 2: Проверить RED**

Run: `./gradlew testDebugUnitTest --tests '*DesktopExchangeTest'`
Expected: тест падает на описанном несовпадении поведения или отсутствующем новом экспорте; ошибка установки окружения не считается RED.

- [ ] **Step 3: Реализовать контракт минимальными шагами**

Для каждого case читать review с ожидаемыми chapter_id/source_path из его JSON; encode/decode проходит через ReviewJson, классификация — через classifyReview:
```kotlin
val canonical = ReviewJson.encode(document)
val state = classifyReview(source.encodeToByteArray(), document)
val activeIds = state.activeEdits.keys.sorted()
val conflictingIds = state.conflictingEdits.sorted()
val unavailableIds = state.unavailable.keys.sorted()
```
`document` и `source` извлечь из case, сохранить канонический JSON-объект и перечисленные массивы в output.json. При заданном env вход обязателен; ошибка fixture/codec проваливает JUnit. Выход писать только после успешного вычисления всех cases. Дополнить output отдельными fixtures anchors/порядка глав, сформированными существующими Kotlin API; типы этих fixtures согласованы в задаче C2.

- [ ] **Step 4: Проверить GREEN и закончить сценарий**

Run: `./gradlew testDebugUnitTest --tests '*DesktopExchangeTest'`
Expected: PASS.

- [ ] Добавить LF/CRLF, emoji, кириллицу, повторные вхождения, неверный selection hash, пустой source, active+stale+conflicting.
- [ ] Документировать env и команду `--rerun-tasks`, чтобы Gradle cache не пропустил новый внешний input.
- [ ] Проверить кодирование Kotlin → Kotlin и файловый запуск с внешним input; TypeScript-сторона подключается C2.

- [ ] **Step 5: Зафиксировать завершённую задачу**

Из корня указанного репозитория добавить только перечисленные файлы этой задачи (и необходимый lockfile), проверить `git diff --cached --check`, затем:

```bash
git commit -m "test(contracts): add desktop exchange fixtures"
```
