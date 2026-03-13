/**
 * Config versioning model.
 * Every time routes or policies are mutated, a new config_version row is inserted.
 * The gateway polls this table and hot-reloads its in-memory cache when the
 * version advances — no restart required.
 */
export interface ConfigVersion {
  id: number;
  version: number;
  checksum: string;
  publishedAt: Date;
}
