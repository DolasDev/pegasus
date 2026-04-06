import { Hono } from 'hono'
import type { OnPremEnv } from '../../types.onprem'
import { mssqlMiddleware } from './middleware'
import { createDomainRouter } from './factory'
import { sharedEntities } from './domains/shared'
import { accountEntities } from './domains/account'
import { saleEntities } from './domains/sale'
import { billingEntities } from './domains/billing'
import { budgetEntities } from './domains/budget'
import { employeeEntities } from './domains/employee'
import { driverEntities } from './domains/driver'
import { crewEntities } from './domains/crew'
import { leadEntities } from './domains/lead'
import { flashEntities } from './domains/flash'
import { localDispatchEntities } from './domains/local-dispatch'
import { mastersEntities } from './domains/masters'
import { menuSpecsEntities } from './domains/menu-specs'
import { personEntities } from './domains/person'
import { portalEntities } from './domains/portal'
import { premiumServicesEntities } from './domains/premium-services'
import { surveyEntities } from './domains/survey'
import { vehicleEntities } from './domains/vehicle'
import { warehouseEntities } from './domains/warehouse'
import { storedProceduresEntities } from './domains/stored-procedures'
import { unsortedEntities } from './domains/unsorted'

const pegiiRouter = new Hono<OnPremEnv>()

pegiiRouter.use('*', mssqlMiddleware)

pegiiRouter.route('/shared', createDomainRouter('shared', sharedEntities))
pegiiRouter.route('/account', createDomainRouter('account', accountEntities))
pegiiRouter.route('/sale', createDomainRouter('sale', saleEntities))
pegiiRouter.route('/billing', createDomainRouter('billing', billingEntities))
pegiiRouter.route('/budget', createDomainRouter('budget', budgetEntities))
pegiiRouter.route('/employee', createDomainRouter('employee', employeeEntities))
pegiiRouter.route('/driver', createDomainRouter('driver', driverEntities))
pegiiRouter.route('/crew', createDomainRouter('crew', crewEntities))
pegiiRouter.route('/lead', createDomainRouter('lead', leadEntities))
pegiiRouter.route('/flash', createDomainRouter('flash', flashEntities))
pegiiRouter.route('/local-dispatch', createDomainRouter('local-dispatch', localDispatchEntities))
pegiiRouter.route('/masters', createDomainRouter('masters', mastersEntities))
pegiiRouter.route('/menu-specs', createDomainRouter('menu-specs', menuSpecsEntities))
pegiiRouter.route('/person', createDomainRouter('person', personEntities))
pegiiRouter.route('/portal', createDomainRouter('portal', portalEntities))
pegiiRouter.route(
  '/premium-services',
  createDomainRouter('premium-services', premiumServicesEntities),
)
pegiiRouter.route('/survey', createDomainRouter('survey', surveyEntities))
pegiiRouter.route('/vehicle', createDomainRouter('vehicle', vehicleEntities))
pegiiRouter.route('/warehouse', createDomainRouter('warehouse', warehouseEntities))
pegiiRouter.route(
  '/stored-procedures',
  createDomainRouter('stored-procedures', storedProceduresEntities),
)
pegiiRouter.route('/unsorted', createDomainRouter('unsorted', unsortedEntities))

export { pegiiRouter }
