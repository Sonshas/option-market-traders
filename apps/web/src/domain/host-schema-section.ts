/** Returns one `-- from: <file>` section of the consolidated host schema SQL (for tests). */
export function hostSchemaSection(schemaSql: string, migrationFile: string): string {
  const marker = `-- from: ${migrationFile}`
  const start = schemaSql.indexOf(marker)
  if (start === -1) throw new Error(`Section not found in host schema: ${migrationFile}`)
  const next = schemaSql.indexOf('-- from: ', start + marker.length)
  return schemaSql.slice(start, next === -1 ? undefined : next)
}
