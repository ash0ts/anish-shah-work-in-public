export async function overflowReport(page) {
  return page.evaluate(() => {
    const limit = window.innerWidth + 1;
    const insideBoundedScroller = (element) => {
      let ancestor = element.parentElement;
      while (ancestor && ancestor !== document.body) {
        const overflowX = getComputedStyle(ancestor).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") {
          const box = ancestor.getBoundingClientRect();
          return box.left >= -1 && box.right <= limit;
        }
        ancestor = ancestor.parentElement;
      }
      return false;
    };
    const offenders = [...document.querySelectorAll("body *")]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return (
          (box.left < -1 || box.right > limit) &&
          !insideBoundedScroller(element)
        );
      })
      .slice(0, 12)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id,
        className: String(element.className).slice(0, 120),
      }));
    return {
      documentWidth: document.documentElement.scrollWidth,
      maximumDocumentWidth:
        window.__roomOverflowAudit?.maximumDocumentWidth ??
        document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      offenders: [
        ...(window.__roomOverflowAudit?.offenders ?? []),
        ...offenders,
      ].filter(
        (entry, index, entries) =>
          entries.findIndex(
            (candidate) =>
              candidate.tag === entry.tag &&
              candidate.id === entry.id &&
              candidate.className === entry.className,
          ) === index,
      ),
    };
  });
}

export async function installOverflowSampler(page) {
  await page.addInitScript(() => {
    const audit = {
      maximumDocumentWidth: 0,
      offenders: [],
    };
    Object.defineProperty(window, "__roomOverflowAudit", {
      configurable: true,
      value: audit,
    });

    const sample = () => {
      const root = document.documentElement;
      audit.maximumDocumentWidth = Math.max(
        audit.maximumDocumentWidth,
        root?.scrollWidth ?? 0,
      );
      if (root) {
        const insideBoundedScroller = (element) => {
          let current = element.parentElement;
          while (current) {
            const style = getComputedStyle(current);
            if (
              ["auto", "scroll"].includes(style.overflowX) &&
              current.scrollWidth > current.clientWidth + 1
            ) {
              return true;
            }
            current = current.parentElement;
          }
          return false;
        };
        for (const element of document.body?.querySelectorAll("*") ?? []) {
          const bounds = element.getBoundingClientRect();
          if (
            (bounds.left < -1 || bounds.right > window.innerWidth + 1) &&
            !insideBoundedScroller(element)
          ) {
            const entry = {
              tag: element.tagName.toLowerCase(),
              id: element.id,
              className: String(element.className).slice(0, 120),
            };
            if (
              !audit.offenders.some(
                (candidate) =>
                  candidate.tag === entry.tag &&
                  candidate.id === entry.id &&
                  candidate.className === entry.className,
              )
            ) {
              audit.offenders.push(entry);
            }
          }
        }
      }
      requestAnimationFrame(sample);
    };
    // Reset each viewport epoch; prior wider widths are not overflow.
    window.addEventListener("resize", () => {
      audit.maximumDocumentWidth = 0;
      audit.offenders = [];
    });
    requestAnimationFrame(sample);
  });
}

export async function settlePaint(page) {
  await page.waitForFunction(
    () =>
      document.querySelector("[data-match-cut-state]")?.getAttribute(
        "data-match-cut-state",
      ) === "settled",
  );
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}
