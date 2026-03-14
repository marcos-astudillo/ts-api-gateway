import { FastifyPluginCallback } from 'fastify';
import { adminAuthMiddleware } from '../middlewares/admin-auth.middleware';
import * as routeController from '../controllers/route.controller';
import * as policyController from '../controllers/policy.controller';
import { RouteSchemas } from '../schemas/route.schema';
import { PolicySchemas } from '../schemas/policy.schema';
import { errorResponse, validationErrorResponse } from '../schemas/common.schema';

/**
 * Admin API — manages routes and policies in the config store.
 * All endpoints require the x-api-key header matching ADMIN_API_KEY.
 *
 * Routes:
 *   GET    /admin/routes
 *   POST   /admin/routes
 *   GET    /admin/routes/:id
 *   PUT    /admin/routes/:id
 *   DELETE /admin/routes/:id
 *
 *   GET    /admin/policies
 *   POST   /admin/policies
 *   DELETE /admin/policies/:id
 */

/** Security requirement applied to every admin endpoint. */
const adminSecurity = [{ ApiKeyAuth: [] }];

export const adminRoutes: FastifyPluginCallback = (app, _opts, done) => {
  // All admin routes require valid API key
  app.addHook('preHandler', adminAuthMiddleware);

  // ─── Routes ─────────────────────────────────────────────────

  app.get('/routes', {
    schema: {
      tags: ['Admin: Routes'],
      summary: 'List all routes',
      description:
        'Returns every registered route (enabled and disabled). Routes are ordered by path prefix length ' +
        'descending so the list reflects the same priority used by the live request router.',
      security: adminSecurity,
      response: {
        200: RouteSchemas.listRoutesResponse,
        401: errorResponse,
      },
    },
  }, routeController.listRoutes);

  app.post('/routes', {
    schema: {
      tags: ['Admin: Routes'],
      summary: 'Create a route',
      description:
        'Registers a new proxy route. After creation the config version is bumped — ' +
        'every gateway instance will pick up the change within `CONFIG_RELOAD_INTERVAL_MS` ms.',
      security: adminSecurity,
      body: RouteSchemas.createRouteBody,
      response: {
        201: RouteSchemas.createdRouteResponse,
        400: validationErrorResponse,
        401: errorResponse,
        409: errorResponse,
      },
    },
  }, routeController.createRoute);

  app.get('/routes/:id', {
    schema: {
      tags: ['Admin: Routes'],
      summary: 'Get a route by ID',
      description: 'Fetches a single route together with its attached policy (if any).',
      security: adminSecurity,
      params: RouteSchemas.uuidParam,
      response: {
        200: RouteSchemas.singleRouteResponse,
        401: errorResponse,
        404: errorResponse,
      },
    },
  }, routeController.getRoute);

  app.put('/routes/:id', {
    schema: {
      tags: ['Admin: Routes'],
      summary: 'Update a route',
      description:
        'Partial update — only send the fields you want to change. ' +
        'The config version is bumped on every successful update, triggering hot reload.',
      security: adminSecurity,
      params: RouteSchemas.uuidParam,
      body: RouteSchemas.updateRouteBody,
      response: {
        200: RouteSchemas.createdRouteResponse,
        400: validationErrorResponse,
        401: errorResponse,
        404: errorResponse,
      },
    },
  }, routeController.updateRoute);

  app.delete('/routes/:id', {
    schema: {
      tags: ['Admin: Routes'],
      summary: 'Delete a route',
      description:
        'Permanently removes the route from the database. Any attached policy is cascade-deleted. ' +
        'The config version is bumped — the route stops receiving traffic after the next hot reload. ' +
        'To temporarily stop traffic without deleting, set `enabled: false` via PUT instead.',
      security: adminSecurity,
      params: RouteSchemas.uuidParam,
      response: {
        204: { type: 'null', description: 'Route deleted.' },
        401: errorResponse,
        404: errorResponse,
      },
    },
  }, routeController.deleteRoute);

  // ─── Policies ───────────────────────────────────────────────

  app.get('/policies', {
    schema: {
      tags: ['Admin: Policies'],
      summary: 'List all policies',
      description: 'Returns every policy across all routes.',
      security: adminSecurity,
      response: {
        200: PolicySchemas.listPoliciesResponse,
        401: errorResponse,
      },
    },
  }, policyController.listPolicies);

  app.post('/policies', {
    schema: {
      tags: ['Admin: Policies'],
      summary: 'Create or update a policy',
      description:
        'Upsert a policy for the given route name. If a policy already exists it is fully replaced. ' +
        'Changes take effect after the next hot reload cycle.',
      security: adminSecurity,
      body: PolicySchemas.createPolicyBody,
      response: {
        201: PolicySchemas.createdPolicyResponse,
        400: validationErrorResponse,
        401: errorResponse,
        404: errorResponse,
      },
    },
  }, policyController.createPolicy);

  app.delete('/policies/:id', {
    schema: {
      tags: ['Admin: Policies'],
      summary: 'Delete a policy',
      description:
        'Removes the policy. The route continues to function but without auth enforcement ' +
        'or custom rate limits (global defaults apply).',
      security: adminSecurity,
      params: PolicySchemas.uuidParam,
      response: {
        204: { type: 'null', description: 'Policy deleted.' },
        401: errorResponse,
        404: errorResponse,
      },
    },
  }, policyController.deletePolicy);
  done();
};
