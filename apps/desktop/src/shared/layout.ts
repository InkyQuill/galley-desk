export type LayoutSettings = { chaptersWidth: number; reviewWidth: number };

export const DEFAULT_LAYOUT: LayoutSettings = { chaptersWidth: 315, reviewWidth: 336 };

export const SIDEBAR_BOUNDS = { min: 240, max: 560 } as const;
