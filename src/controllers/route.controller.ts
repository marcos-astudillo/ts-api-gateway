import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { RouteRepository } from '../repositories/route.repository';
import { PolicyRepository } from '../repositories/policy.repository';
import { ConfigVersionRepository } from '../repositories/config-version.repository';

// ─── Validation schemas ───────────────────────────────────────
const createRouteSchema = z.object({
  name: z.string().min(1).max(255).regex(/^[a-z0-9-_]+$/, 'name must be lowercase alphanumeric, hyphens, or underscores'),
  match: z.object({
    path_prefix: z.string().min(1).startsWith('/'),
  }),
  upstream: z.object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
  }),
  strip_path: z.boolean().optional(),
  timeouts_ms: z
    .object({
      connect: z.number().int().min(1).max(30000).optional(),
      request: z.number().int().min(1).max(60000).optional(),
    })
    .optional(),
  retries: z.number().int().min(0).max(10).optional(),
});

const updateRouteSchema = createRouteSchema
  .partial()
  .extend({ enabled: z.boolean().optional() });

// ─── Dependencies ─────────────────────────────────────────────
const routeRepo = new RouteRepository();
const policyRepo = new PolicyRepository();
const configVersionRepo = new ConfigVersionRepository();

// ─── Handlers ─────────────────────────────────────────────────

export async function listRoutes(
  _req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const routes = await routeRepo.findAll();
  void reply.send({ data: routes, count: routes.length });
}

export async function getRoute(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const route = await routeRepo.findById(req.params.id);
  if (!route) {
    void reply.status(404).send({ error: 'Route not found' });
    return;
  }
  const policy = await policyRepo.findByRouteId(route.id);
  void reply.send({ data: { ...route, policy: policy ?? null } });
}

export async function createRoute(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsed = createRouteSchema.safeParse(req.body);
  if (!parsed.success) {
    void reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const existing = await routeRepo.findByName(parsed.data.name);
  if (existing) {
    void reply.status(409).send({ error: `Route '${parsed.data.name}' already exists` });
    return;
  }

  const route = await routeRepo.create(parsed.data);
  await configVersionRepo.bump();
  void reply.status(201).send({ data: route });
}

export async function updateRoute(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const parsed = updateRouteSchema.safeParse(req.body);
  if (!parsed.success) {
    void reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const route = await routeRepo.update(req.params.id, parsed.data);
  if (!route) {
    void reply.status(404).send({ error: 'Route not found' });
    return;
  }

  await configVersionRepo.bump();
  void reply.send({ data: route });
}

export async function deleteRoute(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const deleted = await routeRepo.delete(req.params.id);
  if (!deleted) {
    void reply.status(404).send({ error: 'Route not found' });
    return;
  }
  await configVersionRepo.bump();
  void reply.status(204).send();
}
