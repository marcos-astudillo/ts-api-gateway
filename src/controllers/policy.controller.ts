import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { PolicyRepository } from '../repositories/policy.repository';
import { RouteRepository } from '../repositories/route.repository';
import { ConfigVersionRepository } from '../repositories/config-version.repository';

// ─── Validation schemas ───────────────────────────────────────
const createPolicySchema = z.object({
  route: z.string().min(1),
  auth_required: z.boolean().optional(),
  rate_limit: z
    .object({
      rps: z.number().int().min(1),
      burst: z.number().int().min(1),
    })
    .optional(),
});

// ─── Dependencies ─────────────────────────────────────────────
const policyRepo = new PolicyRepository();
const routeRepo = new RouteRepository();
const configVersionRepo = new ConfigVersionRepository();

// ─── Handlers ─────────────────────────────────────────────────

export async function listPolicies(
  _req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const policies = await policyRepo.findAll();
  void reply.send({ data: policies, count: policies.length });
}

export async function createPolicy(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsed = createPolicySchema.safeParse(req.body);
  if (!parsed.success) {
    void reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const route = await routeRepo.findByName(parsed.data.route);
  if (!route) {
    void reply.status(404).send({ error: `Route '${parsed.data.route}' not found` });
    return;
  }

  const policy = await policyRepo.upsert(route.id, parsed.data);
  await configVersionRepo.bump();
  void reply.status(201).send({ data: policy });
}

export async function deletePolicy(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const deleted = await policyRepo.delete(req.params.id);
  if (!deleted) {
    void reply.status(404).send({ error: 'Policy not found' });
    return;
  }
  await configVersionRepo.bump();
  void reply.status(204).send();
}
