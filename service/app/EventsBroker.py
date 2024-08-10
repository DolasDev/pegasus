from app import config, ControlFlow
from app.loggers import logger
import json


def processEvent(event, new_event_id):
    logger.debug('Running processEvent()')
    table_prefix = 'equus'
    ControlFlow.insertIntoDB(event, new_event_id, table_prefix=table_prefix)

def processBroadcastEvent(event, event_group):
    logger.debug('Running processBroadcastEvent()')
    event_data_rows = ControlFlow.getBroadcastEventData(event, event_group)
    if(event_group == 'equus'):
        assignment_id = event.event_pk
        response = ControlFlow.sendEquusMilestone(assignment_id, event_data_rows)
        ControlFlow.handleEquusMilestoneResponse(assignment_id, response)
    else:
        logger.error(f'"{event_group}" is not a valid integration_type in the config')
