import { db } from '../config/database';
import { Policy, CreatePolicyDto } from '../models/policy.model';

function mapRow(row: Record<string, unknown>): Policy {
  return {
    id: row['id'] as string,
    routeId: row['route_id'] as string,
    authRequired: row['auth_required'] as boolean,
    rateLimitRps: row['rate_limit_rps'] as number | null,
    rateLimitBurst: row['rate_limit_burst'] as number | null,
    cacheTtlSeconds: (row['cache_ttl_seconds'] as number | null) ?? null,
    createdAt: row['created_at'] as Date,
    updatedAt: row['updated_at'] as Date,
  };
}

export class PolicyRepository {
  async findAll(): Promise<Policy[]> {
    const result = await db.query('SELECT * FROM policies ORDER BY created_at ASC');
    return result.rows.map(mapRow);
  }

  async findById(id: string): Promise<Policy | null> {
    const result = await db.query('SELECT * FROM policies WHERE id = $1', [id]);
    return result.rows[0] ? mapRow(result.rows[0] as Record<string, unknown>) : null;
  }

  async findByRouteId(routeId: string): Promise<Policy | null> {
    const result = await db.query(
      'SELECT * FROM policies WHERE route_id = $1',
      [routeId],
    );
    return result.rows[0] ? mapRow(result.rows[0] as Record<string, unknown>) : null;
  }

  /**
   * Upsert: creates or updates the policy for a given route.
   * Relies on the UNIQUE(route_id) constraint.
   */
  async upsert(routeId: string, dto: CreatePolicyDto): Promise<Policy> {
    const result = await db.query(
      `INSERT INTO policies (route_id, auth_required, rate_limit_rps, rate_limit_burst, cache_ttl_seconds)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (route_id) DO UPDATE SET
         auth_required      = EXCLUDED.auth_required,
         rate_limit_rps     = EXCLUDED.rate_limit_rps,
         rate_limit_burst   = EXCLUDED.rate_limit_burst,
         cache_ttl_seconds  = EXCLUDED.cache_ttl_seconds,
         updated_at         = NOW()
       RETURNING *`,
      [
        routeId,
        dto.auth_required ?? false,
        dto.rate_limit?.rps ?? null,
        dto.rate_limit?.burst ?? null,
        dto.cache_ttl_seconds ?? null,
      ],
    );
    return mapRow(result.rows[0] as Record<string, unknown>);
  }

  async delete(id: string): Promise<boolean> {
    const result = await db.query('DELETE FROM policies WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }
}
