export const motionDurations = {
  page: 320,
  card: 260,
  hover: 160,
  collapse: 280,
  badge: 150,
  shimmer: 1500,
  number: 180
} as const;

export const motionEase = "cubic-bezier(0.22, 1, 0.36, 1)";

export function staggerDelay(index = 0) {
  return Math.min(index * 40, 120);
}

export const motionClassNames = {
  pageEnter: "motion-page-enter",
  cardEnter: "motion-card-enter",
  fadeUp: "motion-fade-up",
  badgePop: "motion-badge-pop",
  hoverLift: "motion-hover-lift",
  numberChange: "motion-number-change",
  shimmer: "motion-shimmer",
  chartEnter: "motion-chart-enter",
  softDots: "motion-soft-dots",
  loadingSweep: "motion-loading-sweep",
  tableRowFocus: "table-row-focus"
} as const;
