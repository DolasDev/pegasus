from app import APICalls, config, CatchRawJson, db, EventsBroker
from app.response_handlers import response_handlers, entity_handlers
from app.models import base
import traceback
from app.loggers import logger
import time

def sendEquusMilestone(assignment_id, event_data_rows):
    logger.debug('Running sendEquusMilestone()')
    service_order_id = lookupEquusServiceOrderId(assignment_id)
    if service_order_id:
        try:
            token = APICalls.equusAccessRequest(config.client_id, config.client_secret)
            mileston_update_body = buildUnitOfWorkFactory(service_order_id, event_data_rows)
            CatchRawJson.logToJson(mileston_update_body, assignment_id, type='EQUUS-Milestone')
            response = APICalls.sendEquusMilestone(config.client_id, config.client_secret, token, mileston_update_body)
            return(response)
        except Exception:
            logger.exception('''Failed to Authenticate with API... \n
                Waiting 5 minutes before retry''')
            logger.critical('''Failed to Authenticate with API... \n
                Waiting 5 minutes before retry''')
            time.sleep(5*60)
            return()
    else:
        logger.error(f'No service order id was found in initiations or sales for equus event with assignment_id: {assignment_id}')

def handleEquusMilestoneResponse(assignment_id, response):
    logger.debug('Running handleEquusMilestoneResponse()')
    parsed_response = response_handlers.parseEqussMilestoneResponse(response)
    CatchRawJson.logToJson(parsed_response, assignment_id, type='EQUUS-Milestone-Response')

def lookupEquusServiceOrderId(service_order_id):
    logger.debug('Running lookupEquusServiceOrderId()')
    peg_db = config.db_pegasus_db_name
    session_manager = base.SessionManager()
    primary_lookup = f'SELECT service_order_id from equus_service_order where assignment_id = {service_order_id}'
    secondary_lookup = f'SELECT equus_service_order_id from {peg_db}.dbo.sales where equus_assignment_id = {service_order_id}'
    try:
        result = session_manager.select(primary_lookup)
    except Exception as e:
        logger.error('Lookup against initiation failed. Checking sales order for manual entry')
        result = session_manager.select(secondary_lookup)
    if len(result) > 0:
        return result[0]['service_order_id']
    else:
        return None


def buildUnitOfWorkFactory(service_order_id, event_data_rows):
    logger.debug('Running buildUnitOfWorkFactory()')
    commandList = [
         {
                "command": "setVariable",
                "sourceField": "ASSIGNMENT_ID",
                "sourceTable": "SERVICE_ORDER",
                "targetVariable": "SERVICE_ORDER!ASSIGNMENT_ID",
                "whereClause": "[ID]=@SERVICE_ORDER_ID",
                "whereParams": [
                    {
                        "name": "@SERVICE_ORDER_ID",
                        "value": service_order_id
                    }
                ]
            },
    ]
    for tabledata in event_data_rows:
        #upsert = buildIndividualUpsertFactory(tabledata, service_order_id)
        upserts = buildUpsertsByPropertyFactory(tabledata, service_order_id)
        commandList = commandList + upserts
    unit_of_work = {
        'command': 'unitOfWork',
        "singleTransaction": "false",
        'commandList': commandList
    }
    return unit_of_work

def buildIndividualUpsertFactory(event_data, service_order_id):
    logger.debug('Running buildIndividualUpsertFactory()')
    upserts = []
    for row in event_data['rows']:
        upsert = {
            'command': 'UPSERT',
            'targetTable': event_data['table_name'],
            "targetVariable": "MOVE_MANAGEMENT!ID",
            "targetProperty": "MOVE_MANAGEMENT!ID",
            'whereClause': '[SERVICE_ORDER_ID]=@SERVICE_ORDER_ID',
            'whereParams': [
                {
                    'name': '@SERVICE_ORDER_ID',
                    'value': f'{service_order_id}'
                }
            ],
            'values': [{'name': key, 'value': value} for key, value in row.items()]
        }
        upsert['values'].append({'name':'ASSIGNMENT_ID','value':'~SERVICE_ORDER!ASSIGNMENT_ID'})
        upserts.append(upsert)
    return upserts

def buildUpsertsByPropertyFactory(event_data, service_order_id):
    logger.debug('Running buildUpsertsByPropertyFactory()')
    units_of_work=[]
    upserts = []
    for row in event_data['rows']:
        del row['event_fk']
        for key, value in row.items():
            upsert = {
                'command': 'UPSERT',
                'targetTable': event_data['table_name'],
                "targetVariable": f"{event_data['table_name']}!ID",
                "targetProperty": f"{event_data['table_name']}!ID",
                'whereClause': '[SERVICE_ORDER_ID]=@SERVICE_ORDER_ID',
                'whereParams': [
                    {
                        'name': '@SERVICE_ORDER_ID',
                        'value': f'{service_order_id}'
                    }
                ],
                'values': [
                    #{'name':'ASSIGNMENT_ID','value':'~SERVICE_ORDER!ASSIGNMENT_ID'},
                    {'name': key, 'value': value}]
            }
            upserts.append(upsert)
        unit_of_work = {
        'command': 'unitOfWork',
        "singleTransaction": "false",
        'commandList': upserts
        }
        units_of_work.append(unit_of_work)
    return units_of_work

def createEvent(event):
    logger.debug('Running createEvent()')
    session_manager = base.SessionManager()
    event_instance = entity_handlers.getEventInstance(event)
    if event_instance.id:
        logger.info("event already processed")
        return(None)  
    else:
        session_manager.current_session.add(event_instance)
        session_manager.current_session_commit(RecordType='Event', RecordId=str(event_instance.event_id))
        return(event_instance.id)

def insertIntoDB(event, new_event_id, table_prefix=None):
    session_manager = base.SessionManager()
    logger.debug('Running insertIntoDB()')
    event_data = event['event_data']['S']['data']
    event_type = event['event_type']['S']
    event_api_id = event['event_id']['S']
    for row in event_data:
        table = row['name'].lower()
        table_name = table_prefix +'_'+table if table_prefix else table_name
        row_data = renameIdKeys(row['values'],table)
        row_data['PEGASUS_API_ID'] = event_api_id
        row_data['PEGASUS_EVENT_ID'] = new_event_id
        valid_fields = base.getTableFields(table_name)
        if (len(valid_fields) > 0 ):
            new_lead_sql = entity_handlers.convertEventPayloadTableInserts(table_name,  valid_fields, row_data)
            session_manager.execute(new_lead_sql,row_data)
    session_manager.current_session_commit(RecordType=event_type, RecordId=event['event_id'])

def renameIdKeys(data, prefix):
    logger.debug('Running renameIdKeys()')
    renamed_data = {}
    for key in data.keys():
        if (key=='ID'):
            new_key = prefix.upper()+'_'+key
            renamed_data[new_key] = data[key]
        elif isinstance((data[key]),dict):
            renamed_data[key+'_DB_VALUE'] = data[key]['DB_VALUE']
            renamed_data[key+'_DISPLAY'] = data[key]['DISPLAY']
        else:
            renamed_data[key] = data[key]
    return(renamed_data)

def getBroadcastEventData(event, event_group): 
    logger.debug('Running getBroadcastEventData()')
    event_pk = event.event_pk
    tables = base.getTablesWithPrefix(event_group)
    tables_rows = []
    for table in tables:
        rows=base.getDataRows(table, event_pk)
        if (len(rows) > 0):
            table_name = table[len('v_'+event_group+'_'):]
            table_row = {
                'table_name':table_name,
                'rows': rows
                }
            tables_rows.append(table_row)
    return tables_rows



def deleteFromQueue(event_id, token):
    logger.debug('Running deleteFromQueue()')
    try:
        return APICalls.deleteEvent(
            config.client_id,
            config.client_secret,
            token, 
            event_id)
    except Exception:
        logger.exception('failed deleting from queue event: ' + event_id )


def getEventsLists(token):
    logger.debug('Running getEventsLists')

    # Get New Events
    new_events = APICalls.getNewEvents(
        config.client_id,
        config.client_secret,
        token)

    if new_events:
        try:
            processed_events = response_handlers.getProcessedResponse(new_events)
            logger.info('getNewEvents ProcessedResponse Status = ' + processed_events.status)
            CatchRawJson.logToJson(processed_events.raw_dict, id=processed_events.Id, type='events')
            return processed_events.response_dict['Items']
        except Exception:
            logger.exception('Control Flow Failed to process response')
    else:
        logger.debug('New events call failed on timeout')


def runEventsReceiver():
    logger.debug('Running runEventsReceiver()')

    # Step 1: API Authentication
    try:
        token = APICalls.accessRequest(config.client_id, config.client_secret)
    except Exception:
        logger.exception('''Failed to Authenticate with API... \n
             Waiting 5 minutes before retry''')
        logger.critical('''Failed to Authenticate with API... \n
             Waiting 5 minutes before retry''')
        time.sleep(5*60)
        return()
    
    # Step 2: Test Database Connection
    try:
        testdb_cxn = db.test_connect_db(config.db_username, config.db_password)
        if testdb_cxn is not None:
            pass
        else:
            raise Exception('Test DB Connection Failed')
    except Exception:
        logger.exception('''Failed to Establish Connection with DB... \n
             Waiting 15 minutes before retry''')
        logger.critical('''Failed to Establish Connection with DB... \n
             Waiting 15 minutes before retry''')
        time.sleep(15*60)
        return()

    # Step 3: Retrieve Events List from PegII api and write to pegasus events table
    events = getEventsLists(token)
    for event in events:
        try:
            new_event_id = createEvent(event)
            if new_event_id:
                EventsBroker.processEvent(event, new_event_id)
            if (config.debug == False):
                deleteFromQueue(event['event_id']['S'], token)
        except Exception as e:
            logger.error(f"Error processing event {event['event_id']['S']}: {e}")
            logger.error(traceback.format_exc())

def runEventsSender():
    logger.debug('Running runEventsSender()')
    
    # Step 1: Test Database Connection
    try:
        testdb_cxn = db.test_connect_db(config.db_username, config.db_password)
        if testdb_cxn is not None:
            pass
        else:
            raise Exception('Test DB Connection Failed')
    except Exception:
        logger.exception('''Failed to Establish Connection with DB... \n
             Waiting 15 minutes before retry''')
        logger.critical('''Failed to Establish Connection with DB... \n
             Waiting 15 minutes before retry''')
        time.sleep(15*60)
        return()

    # Step 2: Retrieve BroadcastEvents from PegII process
    event_groups = {
            'equus-events-receiver' : 'equus',
            'equus-events-sender':'equus',
            'qlab-events-receiver':'qlab'
        }

    event_group = event_groups[config.service_type]
    events = entity_handlers.getOutboundEvents()
    if len(events) > 0:
        for event in events:
            try:
                EventsBroker.processBroadcastEvent(event, event_group)
            except Exception as e:
                logger.error(f"Error processing Broadcast event {event.id}: {e}")
                logger.error(traceback.format_exc())
    else:
        logger.info('no broadcast events found')

