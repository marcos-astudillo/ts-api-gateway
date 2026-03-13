import { FastifyInstance } from 'fastify';
import { adminAuthMiddleware } from '../middlewares/admin-auth.middleware';
import * as routeController from '../controllers/route.controller';
import * as policyController from '../controllers/policy.controller';

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
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // All admin routes require valid API key
  app.addHook('preHandler', adminAuthMiddleware);

  // ─── Routes ─────────────────────────────────────────────────
  app.get('/routes', routeController.listRoutes);
  app.post('/routes', routeController.createRoute);
  app.get('/routes/:id', routeController.getRoute);
  app.put('/routes/:id', routeController.updateRoute);
  app.delete('/routes/:id', routeController.deleteRoute);

  // ─── Policies ───────────────────────────────────────────────
  app.get('/policies', policyController.listPolicies);
  app.post('/policies', policyController.createPolicy);
  app.delete('/policies/:id', policyController.deletePolicy);
}
