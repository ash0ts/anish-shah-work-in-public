const UPDATED_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function updatedDateLabel(
  value: string,
  unavailableLabel = "Sync date unavailable",
): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? unavailableLabel
    : `Updated ${UPDATED_DATE_FORMAT.format(date)}`;
}
