const library = Array.from({ length: 26 }, (_, index) => {
  const formats = ["Vinyl", "CD", "Cassette", "Other"];
  const years = [2024, 2018, 2007, 1996, 1984, null];
  return {
    releaseId: String(91_000 + index),
    title:
      index === 0
        ? "Blue Logic"
        : index === 1
          ? "A Deliberately Long Computational-Music-System Title That Must Wrap Without Expanding the Viewport"
          : `Record ${String(index + 1).padStart(2, "0")}`,
    artists: [
      index === 0
        ? "Arc Lab"
        : `Artist ${String.fromCharCode(65 + (index % 8))}`,
    ],
    releaseYear: years[index % years.length],
    format: formats[index % formats.length],
    copyCount: index < 3 ? 2 : 1,
  };
});

const filterId = (value) =>
  value
    .toLocaleLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "other";

const decadeFor = (year) =>
  year === null ? "Undated" : `${Math.floor(year / 10) * 10}s`;

function countValues(items, labelFor, weighted = false) {
  const counts = new Map();
  for (const item of items) {
    const label = labelFor(item);
    counts.set(
      label,
      (counts.get(label) ?? 0) + (weighted ? item.copyCount : 1),
    );
  }
  return counts;
}

function responseBody(url) {
  const parameters = new URL(url).searchParams;
  const query = (parameters.get("q") ?? "").trim().toLocaleLowerCase();
  const requestedFormat = parameters.get("format") ?? "all";
  const requestedDecade = parameters.get("decade") ?? "all";
  const requestedSort = parameters.get("sort") ?? "title";
  const sort = ["title", "artist", "year"].includes(requestedSort)
    ? requestedSort
    : "title";
  const pageSizeCandidate = Number.parseInt(
    parameters.get("pageSize") ?? "",
    10,
  );
  const pageSize = [12, 24, 36].includes(pageSizeCandidate)
    ? pageSizeCandidate
    : 12;
  const formatCounts = countValues(library, (item) => item.format);
  const decadeCounts = countValues(library, (item) =>
    decadeFor(item.releaseYear),
  );
  const weightedFormats = countValues(
    library,
    (item) => item.format,
    true,
  );
  const weightedDecades = countValues(
    library,
    (item) => decadeFor(item.releaseYear),
    true,
  );
  const format =
    requestedFormat === "all" ||
    [...formatCounts].some(([label]) => filterId(label) === requestedFormat)
      ? requestedFormat
      : "all";
  const decade =
    requestedDecade === "all" ||
    [...decadeCounts].some(([label]) => filterId(label) === requestedDecade)
      ? requestedDecade
      : "all";
  const filtered = library
    .filter((item) => {
      const searchable = `${item.title} ${item.artists.join(" ")}`
        .toLocaleLowerCase();
      return (
        (!query || searchable.includes(query)) &&
        (format === "all" || filterId(item.format) === format) &&
        (decade === "all" || filterId(decadeFor(item.releaseYear)) === decade)
      );
    })
    .sort((left, right) => {
      if (sort === "artist") {
        return (
          left.artists.join(", ").localeCompare(right.artists.join(", ")) ||
          left.title.localeCompare(right.title)
        );
      }
      if (sort === "year") {
        return (
          (right.releaseYear ?? -1) - (left.releaseYear ?? -1) ||
          left.title.localeCompare(right.title)
        );
      }
      return left.title.localeCompare(right.title);
    });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const requestedPage = Math.max(
    1,
    Number.parseInt(parameters.get("page") ?? "", 10) || 1,
  );
  const page = Math.min(requestedPage, totalPages);
  const start = (page - 1) * pageSize;
  const timestamp = "2026-08-03T12:00:00.000Z";
  const physicalItems = library.reduce(
    (total, item) => total + item.copyCount,
    0,
  );
  const formatDecade = countValues(
    library,
    (item) => `${item.format}\u0000${decadeFor(item.releaseYear)}`,
    true,
  );

  return {
    status: "ready",
    fetchedAt: timestamp,
    stale: false,
    payload: {
      provider: "discogs",
      profileUrl: "https://www.discogs.com/user/example-collector",
      coverage: "Physical releases returned from the public Discogs collection",
      totals: {
        physicalItems,
        distinctReleases: library.length,
      },
      formats: [...weightedFormats].map(([label, count]) => ({ label, count })),
      decades: [...weightedDecades]
        .sort(([left], [right]) => {
          if (left === "Undated") return 1;
          if (right === "Undated") return -1;
          return right.localeCompare(left);
        })
        .map(([label, count]) => ({ label, count })),
      formatDecadeMatrix: [...formatDecade].map(([key, count]) => {
        const [format, decade] = key.split("\u0000");
        return { format, decade, count };
      }),
      gallery: {
        ready: true,
        items: filtered.slice(start, start + pageSize),
        page,
        pageSize,
        totalItems: filtered.length,
        libraryTotal: library.length,
        totalPages,
        query: parameters.get("q") ?? "",
        format,
        decade,
        sort,
        formats: [
          { id: "all", label: "All formats", count: library.length },
          ...[...formatCounts].map(([label, count]) => ({
            id: filterId(label),
            label,
            count,
          })),
        ],
        decades: [
          { id: "all", label: "All decades", count: library.length },
          ...[...decadeCounts].map(([label, count]) => ({
            id: filterId(label),
            label,
            count,
          })),
        ],
        sorts: [
          { id: "title", label: "Title" },
          { id: "artist", label: "Artist" },
          { id: "year", label: "Release year" },
        ],
      },
      syncedAt: timestamp,
      freshUntil: "2026-08-03T16:00:00.000Z",
    },
  };
}

export async function installDiscogsFixture(page, requests = []) {
  await page.route("**/api/connectors/discogs**", async (route) => {
    requests.push(new URL(route.request().url()));
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify(responseBody(route.request().url())),
    });
  });
}
