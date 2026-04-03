import { empty, eq, likeStart, static_, eqNum } from '../keyword-helpers'
import type { EntityConfig } from '../types'

const agentTopN = (orderCol: string, top = 400) =>
  `agent_id IN (SELECT TOP ${top} agent_id FROM account WHERE active = 'Y' ORDER BY ${orderCol} DESC)`

export const accountEntities: EntityConfig[] = [
  {
    slug: 'accounts',
    tableName: 'account',
    idField: 'id',
    codeField: 'agent_id',
    idType: 'integer',
    orderBy: 'ORDER BY agent_id',
    listFields:
      'id, code, company, name, street, city, state, zip, vans_acct, managing_branch_id, contract_number, discount, mosys_account_num, preferred_agent, active, salesman, fc_id, relo_mgmt_co_code, relo_mgmt_co_name',
    searchKeywords: [
      empty(),
      eq('CODE', 'agent_id'),
      eq('ACCOUNT', 'agent_id'),
      eq('ACCOUNTCODE', 'agent_id'),
      likeStart('COMPANY', 'company'),
      likeStart('CITY', 'name'),
      eq('STATE', 'state'),
      likeStart('CLASS', 'class_id'),
      static_('VENDOR', "vendor='Y'"),
      {
        keyword: 'ROLE',
        toSql: (p) => {
          switch (p.toUpperCase()) {
            case 'NATIONALACCOUNT':
              return "isnational='Y'"
            case 'CUSTOMER':
              return "customer='Y'"
            case 'VANLINE':
            case 'VANLINEAGENT':
              return "vanlineagent='Y'"
            case 'VENDOR':
              return "vendor='Y'"
            case 'RMC':
            case 'RELOCATIONMANAGEMENTCOMPANY':
              return "is_relo_mgmt_co='Y'"
            case '3RDPARTYAGENT':
            case '3RDPARTY':
            case '3RDPARTYSERVICECOMPANY':
            case '3RDPARTYSERVICEPROVIDER':
              return "agent_id IN (SELECT account_code FROM thirdpartyserviceproviders WHERE active='Y')"
            case 'DOMESTIC':
              return "[domestic]='Y'"
            case 'INTERNATIONAL':
              return "[intl]='Y'"
            case 'COMMERCIAL':
              return "commercial='Y'"
            case 'FOREIGN':
              return "[foreign]='Y'"
            case 'GOVERNMENT':
              return "[government]='Y'"
            case 'WAREHOUSE':
              return "[warehouse]='Y'"
            default:
              return ''
          }
        },
      },
      {
        keyword: 'WITH',
        toSql: (p) => {
          switch (p.toUpperCase()) {
            case 'SERVICEAUTHORIZATIONS':
              return 'agent_id IN (SELECT DISTINCT account_code FROM [accountpremiumservicedetail])'
            case 'WRONGLINESUSED':
              return "([applsvc_comm]<>'')OR([rec_vehicle_comm]<>'')"
            default:
              return ''
          }
        },
      },
      static_('NATIONALACCOUNT', agentTopN('account_count', 300)),
      static_('BOOKINGAGENT', agentTopN('booking_count', 300)),
      static_('BILLINGAGENT', agentTopN('billing_count', 300)),
      static_('AGENTS', agentTopN('origin_count')),
      static_('AGENT', agentTopN('origin_count')),
      static_('ORIGINAGENT', agentTopN('origin_count')),
      static_('DESTINATIONAGENT', agentTopN('origin_count')),
      static_('PACKAGENT', agentTopN('origin_count')),
      static_('HAULINGAGENT', agentTopN('origin_count')),
      static_('OVERFLOWAGENT', agentTopN('origin_count')),
      static_('RULE19AGENT', agentTopN('origin_count')),
      static_('DEBRISAGENT', agentTopN('origin_count')),
      static_('PICKUPAGENT', agentTopN('origin_count')),
      static_('FORWARDINGAGENT', agentTopN('origin_count')),
      static_('STORAGEAGENT', agentTopN('origin_count')),
      static_('SURVEYAGENT', agentTopN('origin_count')),
      static_('UNPACKAGENT', agentTopN('origin_count')),
      static_('ACCOUNTINGHOLD', "acct_flag='Y'"),
      static_('NOTACCOUNTINGHOLD', "acct_flag='N'"),
      static_('3RDPARTY', "is_3rd_party_srvc_co='Y'"),
      static_('ACTIVE', "active='Y'"),
      static_('NOTACTIVE', "active='N'"),
    ],
    freeTextColumns: ['name', 'company', 'city', 'agent_id', 'alpha_code'],
  },
  {
    slug: 'acct-memos',
    tableName: 'acctmemos',
    idField: 'memo_id',
    codeField: 'memo_id',
    idType: 'integer',
    orderBy: 'ORDER BY memo_id DESC',
    listFields:
      'memo_status, acct_memo, call_date, call_time, who_called, regarding, next_date, next_action, next_action2, person, memo_id AS id',
    searchKeywords: [
      empty(),
      eq('ACCOUNTID', 'acct_memo'),
      eq('ACCOUNT', 'acct_memo'),
      eqNum('PERSON', 'person'),
      {
        keyword: 'NEEDACK',
        toSql: () => {
          const today = new Date()
          const mm = String(today.getMonth() + 1).padStart(2, '0')
          const dd = String(today.getDate()).padStart(2, '0')
          const yyyy = today.getFullYear()
          return `(memo_status='N')AND(next_date <= '${mm}/${dd}/${yyyy}')`
        },
      },
      eqNum('CREATEDBY', 'created_by'),
      eqNum('ACKBY', 'person'),
      static_('ACTIVE', "memo_status='Y'"),
    ],
    freeTextColumns: ['who_called'],
  },
]
