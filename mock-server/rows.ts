import { ENTRYSETS, type Entryset } from "./vehicleData";
import { databaseIdForEntrysetId } from "./databases";
import type { Row } from "./evaluate";

/**
 * Flattens one entryset's nested `items[individualLabel][fieldLabel]` shape
 * into the flat `"individualLabel.fieldLabel"` keys the schema's field labels
 * use (see src/query/fieldCatalog.ts), plus a synthetic `__db` key (see
 * mock-server/databases.ts) used only for database scoping.
 */
export function flattenEntryset(entryset: Entryset): Row {
  const row: Row = { id: entryset.id, __db: databaseIdForEntrysetId(entryset.id) };
  for (const [individualLabel, fields] of Object.entries(entryset.items)) {
    for (const [fieldLabel, value] of Object.entries(fields)) {
      row[`${individualLabel}.${fieldLabel}`] = value;
    }
  }
  return row;
}

/** Every entryset the mock server has, flattened once at startup. */
export const ROWS: Row[] = Object.values(ENTRYSETS).map(flattenEntryset);
