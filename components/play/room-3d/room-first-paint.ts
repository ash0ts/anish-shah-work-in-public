/** Let the usable HTML/poster reach the screen before starting the GPU driver. */
export function afterRoomFirstPaint(): Promise<void> {
  if (performance.getEntriesByName("first-contentful-paint").length > 0) {
    return Promise.resolve();
  }
  if (typeof PerformanceObserver !== "undefined" &&
      PerformanceObserver.supportedEntryTypes.includes("paint")) {
    return new Promise((resolve) => {
      const observer = new PerformanceObserver((list) => {
        if (!list.getEntries().some((entry) => entry.name === "first-contentful-paint")) return;
        observer.disconnect();
        resolve();
      });
      observer.observe({ type: "paint", buffered: true });
    });
  }
  // Paint Timing is not universal. Two frames yield a rendering opportunity
  // without a timer, user-agent branch, or an extra entrance interaction.
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}
