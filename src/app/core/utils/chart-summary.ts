interface ChartSeries {
  readonly name?: string;
  readonly data: readonly unknown[];
}

/**
 * A chart in words, for whoever cannot see it (WCAG 1.1.1): its title, then each series with its
 * values, as they would be read off the axis.
 */
export function describeChart(title: string, categories: readonly unknown[] | undefined, series: readonly ChartSeries[] | undefined): string {
  const lines = (series ?? []).map((one) => {
    const values = one.data.map((value, i) => (categories?.[i] === undefined ? `${value}` : `${categories[i]} : ${value}`));
    return [one.name, values.join(', ')].filter(Boolean).join(' — ');
  });
  return [title, ...lines].join('. ');
}

/** The same options, with the description ApexCharts gives to its chart for a screen reader. */
export function describedChart<T extends { chart?: object; series?: unknown; xaxis?: { categories?: unknown } }>(title: string, options: T): T {
  const description = describeChart(title, options.xaxis?.categories as unknown[] | undefined, options.series as ChartSeries[] | undefined);
  return { ...options, chart: { ...options.chart, accessibility: { enabled: true, description } } };
}
