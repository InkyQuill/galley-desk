type Props = {
  before: string;
};

/** Показывает оригинал (`before`) правки — рендерится родителем и только
 * когда курсор/hover активны над подсветкой (см. ChapterContent). */
export function EditFlyout({ before }: Props) {
  return (
    <span
      role="tooltip"
      className="absolute left-0 top-full z-20 mt-1 w-max max-w-xs rounded-lg bg-app-text px-2 py-1 text-xs text-app-bg shadow-[var(--app-card-shadow)]"
    >
      Было: «{before}»
    </span>
  );
}
