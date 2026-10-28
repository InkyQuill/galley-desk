import { IconMessage, IconPencil, IconAlertTriangle, IconEye, IconThumbUp, IconSparkles } from '@tabler/icons-react';
export const signalLabels = { note: 'Заметка', change_required: 'Требуется правка', warning: 'Предупреждение', review: 'На проверку', good: 'Хорошо', brilliant: 'Блестяще' };
export const signalIcons = { note: IconMessage, change_required: IconPencil, warning: IconAlertTriangle, review: IconEye, good: IconThumbUp, brilliant: IconSparkles };

export const signalHelp = {
  ...signalLabels,
  good: 'Фрагмент понравился — сохранить при редактировании',
  brilliant: 'Фрагмент особенно понравился — обязательно сохранить его сильные стороны',
};
