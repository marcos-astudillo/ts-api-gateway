import crypto from 'crypto';
import { db } from '../config/database';
import { ConfigVersion } from '../models/config-version.model';

function mapRow(row: Record<string, unknown>): ConfigVersion {
  return {
    id: row['id'] as number,
    version: row['version'] as number,
    checksum: row['checksum'] as string,
    publishedAt: row['published_at'] as Date,
  };
}

export class ConfigVersionRepository {
  async getLatest(): Promise<ConfigVersion | null> {
    const result = await db.query(
      'SELECT * FROM config_versions ORDER BY version DESC LIMIT 1',
    );
    return result.rows[0] ? mapRow(result.rows[0] as Record<string, unknown>) : null;
  }

  /**
   * Inserts a new config version row, incrementing from the latest.
   * Called after every mutation to routes or policies so the gateway
   * can detect changes and hot-reload without restarting.
   */
  async bump(): Promise<ConfigVersion> {
    const latest = await this.getLatest();
    const nextVersion = (latest?.version ?? 0) + 1;
    const checksum = crypto.randomBytes(8).toString('hex');

    const result = await db.query(
      'INSERT INTO config_versions (version, checksum) VALUES ($1, $2) RETURNING *',
      [nextVersion, checksum],
    );
    return mapRow(result.rows[0] as Record<string, unknown>);
  }
}
