import { Hono } from 'hono'
import type { OnPremEnv } from '../../types.onprem'
import { mssqlMiddleware } from '../pegii/middleware'
import { createDomainRouter } from '../pegii/factory'

import { glEntities } from './domains/gl'
import { portalEntities } from './domains/portal'
import { atlasEntities } from './domains/atlas'
import { textMessagingEntities } from './domains/text-messaging'
import { emailEntities } from './domains/email'
import { flatRateEntities } from './domains/flat-rate'
import { loansEntities } from './domains/loans'
import { settingsEntities } from './domains/settings'
import { mastersEntities } from './domains/masters'
import { textTemplatesEntities } from './domains/text-templates'
import { saleEntities } from './domains/sale'

const efwkRouter = new Hono<OnPremEnv>()

efwkRouter.use('*', mssqlMiddleware)

efwkRouter.route('/gl', createDomainRouter('gl', glEntities))
efwkRouter.route('/portal', createDomainRouter('portal', portalEntities))
efwkRouter.route('/atlas', createDomainRouter('atlas', atlasEntities))
efwkRouter.route('/text-messaging', createDomainRouter('text-messaging', textMessagingEntities))
efwkRouter.route('/email', createDomainRouter('email', emailEntities))
efwkRouter.route('/flat-rate', createDomainRouter('flat-rate', flatRateEntities))
efwkRouter.route('/loans', createDomainRouter('loans', loansEntities))
efwkRouter.route('/settings', createDomainRouter('settings', settingsEntities))
efwkRouter.route('/masters', createDomainRouter('masters', mastersEntities))
efwkRouter.route('/text-templates', createDomainRouter('text-templates', textTemplatesEntities))
efwkRouter.route('/sale', createDomainRouter('sale', saleEntities))

export { efwkRouter }
