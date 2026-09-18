import type { LayoutSettings } from '../../shared/layout';
import { SIDEBAR_BOUNDS } from '../../shared/layout';

export type EffectiveLayout = {
  chaptersWidth: number;
  reviewWidth: number;
  chaptersCollapsed: boolean;
  reviewCollapsed: boolean;
};

export const CENTER_MIN_WIDTH = 480;
export const RESIZER_WIDTH = 6;

const clamp = (value: number): number =>
  Math.min(SIDEBAR_BOUNDS.max, Math.max(SIDEBAR_BOUNDS.min, value));

export function fitLayout(preferred: LayoutSettings, availableWidth: number): EffectiveLayout {
  const chapters = clamp(preferred.chaptersWidth);
  const review = clamp(preferred.reviewWidth);
  const bothBudget = Math.max(0, Math.floor(availableWidth) - CENTER_MIN_WIDTH - RESIZER_WIDTH * 2);

  if (bothBudget >= SIDEBAR_BOUNDS.min * 2) {
    let chaptersWidth = chapters;
    let reviewWidth = review;
    let excess = chaptersWidth + reviewWidth - bothBudget;
    if (excess > 0) {
      const chaptersRoom = chaptersWidth - SIDEBAR_BOUNDS.min;
      const reviewRoom = reviewWidth - SIDEBAR_BOUNDS.min;
      const room = chaptersRoom + reviewRoom;
      const chaptersReduction = room > 0 ? Math.min(chaptersRoom, Math.round(excess * chaptersRoom / room)) : 0;
      chaptersWidth -= chaptersReduction;
      excess -= chaptersReduction;
      const reviewReduction = Math.min(reviewRoom, excess);
      reviewWidth -= reviewReduction;
      excess -= reviewReduction;
      if (excess > 0) chaptersWidth -= Math.min(chaptersWidth - SIDEBAR_BOUNDS.min, excess);
    }
    return { chaptersWidth, reviewWidth, chaptersCollapsed: false, reviewCollapsed: false };
  }

  const chaptersBudget = Math.floor(availableWidth) - CENTER_MIN_WIDTH - RESIZER_WIDTH;
  if (chaptersBudget >= SIDEBAR_BOUNDS.min) {
    return {
      chaptersWidth: Math.min(chapters, chaptersBudget),
      reviewWidth: review,
      chaptersCollapsed: false,
      reviewCollapsed: true,
    };
  }

  return {
    chaptersWidth: chapters,
    reviewWidth: review,
    chaptersCollapsed: true,
    reviewCollapsed: true,
  };
}
