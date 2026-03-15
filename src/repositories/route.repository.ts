import { db } from '../config/database';
import { Route, CreateRouteDto, UpdateRouteDto } from '../models/route.model';

// ─── Row mapper ──────────────────────────────────────────────
function mapRow(row: Record<string, unknown>): Route {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    pathPrefix: row['path_prefix'] as string,
    upstreamHost: row['upstream_host'] as string,
    upstreamPort: row['upstream_port'] as number,
    stripPath: row['strip_path'] as boolean,
    connectTimeoutMs: row['connect_timeout_ms'] as number,
    requestTimeoutMs: row['request_timeout_ms'] as number,
    retries: row['retries'] as number,
    enabled: row['enabled'] as boolean,
    canaryUpstreamHost: (row['canary_upstream_host'] as string | null) ?? null,
    canaryUpstreamPort: (row['canary_upstream_port'] as number | null) ?? null,
    canaryWeight: (row['canary_weight'] as number | null) ?? null,
    createdAt: row['created_at'] as Date,
    updatedAt: row['updated_at'] as Date,
  };
}

export class RouteRepository {
  async findAll(): Promise<Route[]> {
    const result = await db.query(
      'SELECT * FROM routes ORDER BY created_at ASC',
    );
    return result.rows.map(mapRow);
  }

  async findById(id: string): Promise<Route | null> {
    const result = await db.query('SELECT * FROM routes WHERE id = $1', [id]);
    return result.rows[0] ? mapRow(result.rows[0] as Record<string, unknown>) : null;
  }

  async findByName(name: string): Promise<Route | null> {
    const result = await db.query('SELECT * FROM routes WHERE name = $1', [name]);
    return result.rows[0] ? mapRow(result.rows[0] as Record<string, unknown>) : null;
  }

  /** Returns only enabled routes, ordered longest-prefix-first for fast matching. */
  async findEnabled(): Promise<Route[]> {
    const result = await db.query(
      "SELECT * FROM routes WHERE enabled = true ORDER BY LENGTH(path_prefix) DESC",
    );
    return result.rows.map(mapRow);
  }

  async create(dto: CreateRouteDto): Promise<Route> {
    const result = await db.query(
      `INSERT INTO routes
        (name, path_prefix, upstream_host, upstream_port, strip_path,
         connect_timeout_ms, request_timeout_ms, retries,
         canary_upstream_host, canary_upstream_port, canary_weight)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        dto.name,
        dto.match.path_prefix,
        dto.upstream.host,
        dto.upstream.port,
        dto.strip_path ?? false,
        dto.timeouts_ms?.connect ?? 200,
        dto.timeouts_ms?.request ?? 2000,
        dto.retries ?? 2,
        dto.canary?.upstream.host ?? null,
        dto.canary?.upstream.port ?? null,
        dto.canary?.weight ?? null,
      ],
    );
    return mapRow(result.rows[0] as Record<string, unknown>);
  }

  async update(id: string, dto: UpdateRouteDto): Promise<Route | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const result = await db.query(
      `UPDATE routes SET
        name                 = $1,
        path_prefix          = $2,
        upstream_host        = $3,
        upstream_port        = $4,
        strip_path           = $5,
        connect_timeout_ms   = $6,
        request_timeout_ms   = $7,
        retries              = $8,
        enabled              = $9,
        canary_upstream_host = $10,
        canary_upstream_port = $11,
        canary_weight        = $12,
        updated_at           = NOW()
       WHERE id = $13
       RETURNING *`,
      [
        dto.name              ?? existing.name,
        dto.match?.path_prefix ?? existing.pathPrefix,
        dto.upstream?.host     ?? existing.upstreamHost,
        dto.upstream?.port     ?? existing.upstreamPort,
        dto.strip_path         ?? existing.stripPath,
        dto.timeouts_ms?.connect ?? existing.connectTimeoutMs,
        dto.timeouts_ms?.request ?? existing.requestTimeoutMs,
        dto.retries            ?? existing.retries,
        dto.enabled            ?? existing.enabled,
        dto.canary?.upstream.host ?? existing.canaryUpstreamHost,
        dto.canary?.upstream.port ?? existing.canaryUpstreamPort,
        dto.canary?.weight        ?? existing.canaryWeight,
        id,
      ],
    );
    return mapRow(result.rows[0] as Record<string, unknown>);
  }

  async delete(id: string): Promise<boolean> {
    const result = await db.query('DELETE FROM routes WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }
}
