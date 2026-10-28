// PostgreSQL 17 pg_dump/restore distributes this array cast onto its three
// fixed varchar literals. Both expressions compare the same text values,
// including NULL semantics. No other SQL text or catalog attributes change.
const array =
  "ARRAY['image/jpeg'::character varying, 'image/png'::character varying, 'image/webp'::character varying]::text[]";
const elements =
  "ARRAY['image/jpeg'::character varying::text, 'image/png'::character varying::text, 'image/webp'::character varying::text]";
const definition = (values: string) =>
  `CHECK (state <> 'READY'::blogpost."MediaState" OR width IS NOT NULL AND height IS NOT NULL AND "mimeType" IS NOT NULL AND ("mimeType"::text = ANY (${values})) AND jsonb_array_length(variants) = 3)`;
export function canonicalCatalogConstraint<T extends Record<string, unknown>>(
  row: T,
): T {
  if (
    row.relation === 'MediaAsset' &&
    row.name === 'media_ready' &&
    row.kind === 'c' &&
    row.definition === definition(array)
  )
    return { ...row, definition: definition(elements) };
  return row;
}
