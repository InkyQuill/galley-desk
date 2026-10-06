// Тематические уведомления рабочей области (Task 8). BookWindow собирает
// book-level состояния (сбой сохранения, отказ операции, внешнее изменение,
// только-чтение, сбой сохранения ширины) в единственный NoticeCenter внутри
// .book — плавающий нижний центр поверх редактора вместо прежних
// нестилизованных flow-полос над .book__body (reflow редактора убран).
// Контекстные ошибки форм (MetadataPopover, ChapterDialogs, RenameBookDialog,
// ChapterNote, Diagnostics, RecentBooks, ErrorBoundary) сознательно НЕ
// переезжают: они остаются возле своего действия.
//
// Доступность: ошибки и предупреждения состояния объявляются через
// role="alert" (появление озвучивается немедленно; прежние flow-полосы тоже
// были alert — регресса анонсов нет), информационное уведомление (openWarning)
// — вежливый role="status". Один логический сбой = одна карточка = один alert.
// Таймеров нет: уведомление убирает разрешение состояния или явная кнопка
// закрытия (IconX с полным aria-label).
import type { ComponentType, ReactNode } from 'react';
import { IconAlertCircle, IconAlertTriangle, IconInfoCircle, IconX } from '@tabler/icons-react';

export type NoticeKind = 'error' | 'warning' | 'info';

export type NoticeProps = {
  kind: NoticeKind;
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
  onDismiss?: () => void;
};

const NOTICE_ICONS: Record<NoticeKind, ComponentType<{ className?: string }>> = {
  error: IconAlertCircle,
  warning: IconAlertTriangle,
  info: IconInfoCircle,
};

/** Одна карточка уведомления: иконка по kind, текст, действия и опциональный крестик. */
export function Notice({ kind, title, children, actions, onDismiss }: NoticeProps) {
  const Icon = NOTICE_ICONS[kind];
  return (
    <div className={`notice notice--${kind}`} role={kind === 'info' ? 'status' : 'alert'}>
      <Icon className="notice__icon" />
      <div className="notice__body">
        {title !== undefined && <p className="notice__title">{title}</p>}
        <div className="notice__message">{children}</div>
        {actions !== undefined && <div className="notice__actions">{actions}</div>}
      </div>
      {onDismiss !== undefined && (
        <button type="button" className="notice__dismiss" aria-label="Скрыть уведомление" onClick={onDismiss}>
          <IconX aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Единственный стек уведомлений книги: плавающий нижний центр внутри .book. */
export function NoticeCenter({ children }: { children: ReactNode }) {
  return <div className="notice-center">{children}</div>;
}
