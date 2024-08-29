from app import config, ControlFlow
from app.loggers import logger
import json


def processEvent(event, new_event_id):
    logger.info('Running processEvent()')
    table_prefix = 'equus'
    ControlFlow.insertIntoDB(event, new_event_id, table_prefix=table_prefix)

def processBroadcastEvent(event, event_group):
    logger.info('Running processBroadcastEvent()')
    event_data_rows = ControlFlow.getBroadcastEventData(event, event_group)
    logger.info(f"event_data_rows: {event_data_rows}")
    if len(event_data_rows) > 0:
        if(event_group == 'equus'):
            assignment_id = event.event_pk
            response = ControlFlow.sendEquusMilestone(assignment_id, event_data_rows)
            ControlFlow.handleEquusMilestoneResponse(assignment_id, response)
        else:
            logger.error(f'"{event_group}" is not a valid integration_type in the config')
    else:
        logger.info('no data rows for this event')
