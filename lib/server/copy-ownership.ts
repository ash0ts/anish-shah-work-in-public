import {
  buildCopyOwnershipReport,
  CopyOwnershipError,
  type CopyOwnershipReport,
} from "@/lib/copy-ownership";
import {
  EditorialError,
  listEditorialRecords,
} from "@/lib/server/editorial";

const MAX_WORK_GROUP_RECORDS = 1_000;

export async function getCopyOwnershipReport(): Promise<CopyOwnershipReport> {
  const result = await listEditorialRecords({
    limit: MAX_WORK_GROUP_RECORDS,
    offset: 0,
    recordType: "work_group",
  });
  if (result.pagination.total > result.records.length) {
    throw new EditorialError(
      "copy_ownership_incomplete",
      "The copy ownership report could not account for every WorkGroup.",
      503,
    );
  }

  try {
    return buildCopyOwnershipReport(result.records);
  } catch (error) {
    if (error instanceof CopyOwnershipError) {
      throw new EditorialError(error.code, error.message, 503);
    }
    throw error;
  }
}
