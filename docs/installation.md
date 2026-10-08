# Установка Galley Desk

Готовые приложения публикуются в [GitHub Releases](https://github.com/InkyQuill/galley-desk/releases/latest).
Node.js, npm и исходники для их запуска не нужны. Если релизов ещё нет,
автоматизацию сначала нужно включить по [runbook выпуска](runbooks/release.md).

## Linux: одна команда

Нужны `curl`, Python 3, `sha256sum` и `sudo`. Закройте Galley Desk перед установкой
или обновлением, затем выполните от обычного пользователя:

```sh
(installer=$(mktemp) && trap 'rm -f -- "$installer"' EXIT && curl -fsSL https://github.com/InkyQuill/galley-desk/releases/latest/download/install.sh -o "$installer" && bash "$installer")
```

Команда скачивает последний стабильный релиз для x86_64 или ARM64, проверяет
SHA-256 и устанавливает приложение в `/opt/galley-desk`. В меню приложений
появляется **Galley Desk**, в терминале доступна команда `galley-desk`.
Права администратора нужны только на этапе установки. Приложение не запускается
автоматически и не должно запускаться от root.

Это загрузка и выполнение скрипта из официального релиза. Для предварительного
просмотра сохраните его в файл:

```sh
curl -fsSL https://github.com/InkyQuill/galley-desk/releases/latest/download/install.sh -o install-galley-desk.sh
less install-galley-desk.sh
bash install-galley-desk.sh
```

Повторите команду для обновления. Чтобы выбрать версию или вернуться к старой:

```sh
bash install-galley-desk.sh --version 0.2.0
```

Здесь `0.2.0` — пример: используйте существующий номер из Releases.
Для скачивания и проверки без установки:

```sh
bash install-galley-desk.sh --version 0.2.0 --download-only ./galley-download
```

Для офлайн-установки заранее скачайте ZIP и `SHA256SUMS` одного релиза в каталог,
затем выполните `bash install-galley-desk.sh --from-directory ./galley-download`.
Проверка checksum выполняется и в этом режиме. `--download-only` сохраняет
всё необходимое, включая полный `SHA256SUMS`.

Установщик сохраняет предыдущие каталоги под `/opt/galley-desk`, а `current`
указывает на выбранную установку. Старые каталоги можно удалить после закрытия
приложения, оставив цель `readlink -f /opt/galley-desk/current`.
Рукописи и профиль не находятся в каталоге установки и при обновлении сохраняются.
Автоматического обновления внутри приложения пока нет.

## Linux: системные пакеты

Выберите `.deb` для Ubuntu/Debian или `.rpm` для Fedora; `x64` означает
Intel/AMD 64-bit, `arm64` — ARM 64-bit. Скачайте пакет и `SHA256SUMS`
из **одного** релиза. В каталоге загрузки:

```sh
sha256sum --ignore-missing -c SHA256SUMS
```

Убедитесь, что строка именно выбранного пакета имеет результат `OK`. Затем:

```sh
# Ubuntu / Debian — замените имя на скачанный файл
sudo apt install ./galley-desk-VERSION-linux-x64.deb

# Fedora
sudo dnf install ./galley-desk-VERSION-linux-x64.rpm
```

Пакеты ставятся в `/usr/lib/galley-desk` и добавляют пункт меню.
Обновление — установка нового пакета той же командой. Удаление:
`sudo apt remove galley-desk` или `sudo dnf remove galley-desk`.
Используйте один способ установки: перед переходом с пакета на установщик
или обратно удалите прежнюю установку, чтобы избежать дублирования.

## Arch Linux / CachyOS: pacman

Для x86_64 скачайте `galley-desk-VERSION-1-x86_64.pkg.tar.zst` и `SHA256SUMS`
из одного релиза. Это полноценный пакет pacman с зависимостями и метаданными,
а не обычный архив приложения. После проверки checksum:

```sh
sudo pacman -U ./galley-desk-VERSION-1-x86_64.pkg.tar.zst
```

Pacman установит зависимости, приложение в `/usr/lib/galley-desk`, команду
`galley-desk` и пункт меню. Обновление — `pacman -U` с новым пакетом;
удаление — `sudo pacman -R galley-desk`. Книги и профиль не удаляются.
Пакет не подписан; checksum проверяется отдельно. Arch ARM64 пока не собирается.
Этот способ не требует Python, curl или ZIP-установщика. Перед переходом с
установки в `/opt` удалите её по инструкции ниже, чтобы не осталось двух копий.

## Требования и sandbox Linux

Сборки используют glibc: x64 собирается на Ubuntu 22.04, ARM64 — на Ubuntu 24.04.
Alpine/musl не поддерживается. Нужна графическая сессия X11 или Wayland с
Xwayland, а также системные библиотеки Electron: GTK 3, NSS, ATK/AT-SPI, GBM,
ALSA, X11 и xkbcommon. `.deb`/`.rpm` устанавливают зависимости через менеджер
пакетов; для установки из ZIP их необходимо установить средствами дистрибутива.
На Arch Linux это, в частности, `gtk3 nss alsa-lib libxss libxtst mesa`.

Установщик и пакеты назначают `chrome-sandbox` владельцу root и права `4755`.
Это штатный SUID sandbox Chromium, необходимый на системах с ограниченными
user namespaces. Путь установки не содержит пробелов. Не используйте
`--no-sandbox`, не запускайте приложение через sudo и не отключайте системные
ограничения безопасности. ZIP сам по себе не сохраняет root-владельца:
для обычной установки используйте установщик либо системный пакет.

Удаление установки из скрипта (при закрытом приложении):

```sh
sudo rm /usr/local/bin/galley-desk
sudo rm /usr/local/share/applications/galley-desk.desktop
sudo rm -r /opt/galley-desk
```

Эти команды удаляют только установленное приложение; книги и пользовательский
профиль остаются на месте.

## macOS

Скачайте `galley-desk-VERSION-darwin-arm64.zip` для Apple Silicon или
`galley-desk-VERSION-darwin-x64.zip` для Intel. Сверьте SHA-256 скачанного файла
командой `shasum -a 256 ИМЯ_АРХИВА` со строкой в `SHA256SUMS`, распакуйте ZIP
и перенесите **Galley Desk.app** в **Applications**.

Приложение **не подписано Developer ID и не нотарифицировано**. macOS может
заблокировать первый запуск. Если вы доверяете скачанному релизу, после попытки
запуска откройте **System Settings → Privacy & Security → Open Anyway**.
Не отключайте Gatekeeper целиком. На управляемом Mac политика организации
может запрещать такой запуск.

Обновление: закройте приложение и замените `.app` новой версией. Для удаления
переместите `.app` в корзину. Книги и профиль сохраняются.
Нативные проверки macOS (IME, picker, clipboard) пока **NOT RUN**; успешная
сборка в CI не является подтверждением этих сценариев.

## Контроль целостности

Каждый релиз содержит `SHA256SUMS` для всех установочных файлов и `install.sh`.
Установщик фиксирует один номер версии, даже если новый релиз опубликован во
время скачивания. Несовпадение или отсутствие checksum останавливает установку.
Контрольная сумма проверяет целостность; она не заменяет цифровую подпись.
