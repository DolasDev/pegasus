import copy
import json
from app.models import Events, base  # Ignore linter, these are used in the getMappedClassInstance function
from app.loggers import logger

#  Entity Handlers take a dictionary as input and return a list of top level \
#  mapped-class entities ready for ORM oporations.


# getMappedClassInstance is passed
# {model} (sourceProperty imported models), \
# {mapped_class} (a top level API entity, example for Events - "Event"),\
# {dictionary} (response.body parsed to dictionary by another entity handler)\
# {Parent} leave as none. This is used recursively in the function to pass the top level entity
def lookUpInstance(natural_key_value, model, mapped_class):
    session_manager = base.SessionManager()
    logger.info('Running lookUpInstance()')
    WorkingMappedClass = eval(model + '.' + mapped_class)
    entity = session_manager.current_session.query(WorkingMappedClass).filter_by(event_id=natural_key_value).first()
    session_manager.closeSession()
    return(entity)


def lookUpEvents(model, mapped_class, _session_manager):
    session_manager = _session_manager
    logger.info('Running lookUpEvents()')
    WorkingMappedClass = eval(model + '.' + mapped_class)
    events = session_manager.current_session.query(WorkingMappedClass).filter_by(Processed_Status='New').all()
    return(events)


def dropUnmappedAttributes(dictionary, mapped_class_instance):
    logger.info('Running dropUnmappedAttributes')
    working_dict = copy.deepcopy(dictionary)
    for key, value in dictionary.items():
        try:
            getattr(mapped_class_instance, key)
        except Exception:
            working_dict.pop(key)
    return(working_dict)

def parseDynamoDB(dictionary):
    logger.info('Running parseDynamoDB')
    working_dict = copy.deepcopy(dictionary)
    for key, value in dictionary.items():
        if isinstance(value, dict):
            try:
                sval = value['S']
                working_dict[key] = sval
            except Exception:
                pass
    return(working_dict)


def getMappedClassInstance(model, mapped_class, dictionary, Id=None, parent=None):
    logger.info('Running getMappedClassInstance()')
    WorkingMappedClass = eval(model + '.' + mapped_class)
    working_mapped_instance = WorkingMappedClass()
    cleaned_dict = dropUnmappedAttributes(dictionary, working_mapped_instance)
    flattened_dict = parseDynamoDB(cleaned_dict)
    prepared_dict = copy.deepcopy(flattened_dict)

    for key, value in prepared_dict.items():
        if isinstance(value, dict) or isinstance(value, list) or value is None:
            cleaned_dict.pop(key)
        else:
            pass

    if parent:
        child_instance = WorkingMappedClass(**cleaned_dict)
        try:
            getattr(parent, mapped_class).append(child_instance)
        except Exception:
            logger.exception('Appending Child to Parent instance failed - '+ mapped_class + 'has value:', prepared_dict, 'skipping append')
    else:
        parent_instance = WorkingMappedClass(**cleaned_dict)

    for key, value in cleaned_dict.items():
        if isinstance(value, dict):
            getMappedClassInstance(model,
                                    key,
                                    value,
                                    parent=parent_instance)
        elif isinstance(value, list):
            for each in value:
                getMappedClassInstance(model,
                                        key,
                                        each,
                                        parent=parent_instance)
        else:
            pass

    if parent:
        pass
    else:
        parent_instance.Interface_Status = 'inbound'
        parent_instance.Id = Id
        return(parent_instance)


def getEventInstance(event, Id=None):
    logger.info('Running getEventInstance()')
    api_event = Events.Event()
    api_event.event_id = event['event_id']['S']
    api_event.event_type = event['event_type']['S']
    api_event.event_datetime = event['event_datetime']['S']
    api_event.event_status = event['event_status']['S']
    api_event.event_publisher = event['event_publisher']['S']
    api_event.event_data = json.dumps(event['event_data']['S'])

    session_manager = base.SessionManager()
    existing_instance = session_manager.current_session.query(Events.Event).filter_by(event_id=api_event.event_id).first()
    session_manager.closeSession()
    if existing_instance:
        logger.info('Instance of Event Already Exists')
        api_event.id = existing_instance.id
    else:
        logger.info('New Event')
    return api_event


def mapToLead(data, table, property):
    logger.info('Running mapToLead()')
    tableEntry = next((item for item in data if item["name"] == table), None)
    if (tableEntry):
        return tableEntry['values'].get(property)

def convertEventPayloadTableInserts(table_name, valid_columns, data):
    logger.info('Running convertEventPayloadTableInserts()')
    valid_data = {key: data[key] for key in data if key in valid_columns}
    columns = ', '.join(valid_data.keys())
    placeholders = ', '.join([f':{key}' for key in valid_data.keys()])
    sql = f"INSERT INTO {table_name} ({columns}) VALUES ({placeholders})"
    return(sql)

def getOutboundEvents():
    logger.info('Running getOutboundEvents()')
    session_manager = base.SessionManager()    
    events = session_manager.current_session.query(Events.BoadcastEvent).filter_by(event_status='NEW',event_group='equus')
    return(events.all())