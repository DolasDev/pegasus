import requests
from app.loggers import logger
from app.models import base, Events
try:
    from app import config
except Exception:
    import config

api_url = config.api_base_url
logger.info('API Calls Directed at Production')


# ADE - Access Request Description

def addCallErrorEvent(LeadId=None, OpportunityId=None, QuoteId=None):
    logger.info('Running addCallErrorEvent()')
    logger.error('Error on API Call. Added error event to be retried on next cycle')
    call_error = {
        'Interface_Status': 'Inbound',
        'Processed_Status': 'New',
        'Type': 'Pegasus API Receiver - API Call Error',
        'LeadId': LeadId,
        'OpportunityId': OpportunityId,
        'QuoteId': QuoteId
        }
    error_event = Events.Event(**call_error)
    session_manager = base.SessionManager()
    session_manager.current_session.add(error_event)
    session_manager.current_session_commit()
    session_manager.closeSession()


def deleteEvent(api_key, event_id):
    logger.info('Running deleteEvent()')
    try:
        url = api_url + "/events/" + event_id
        headers = {"Authorization": f"Bearer {api_key}"}

        response = requests.delete(url, headers=headers)

        # Raise an exception for HTTP errors
        response.raise_for_status()

        return response
    except requests.exceptions.RequestException as e:
        logger.exception("Error occurred during deleteEvent: %s", str(e))
        return None
    except Exception:
        logger.info('Some sort of network error on deleteEvent')
        return None

def sendEquusMilestone(api_key, milestone_update_body):
    logger.info('Running sendEquusMilestone()')

    url = api_url
    headers = {
        'Authorization': f'Bearer {api_key}',
        'User-Agent': 'MyApp/1.0',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'assignmentproinstanceid': '09b18e2b-7f06-4dd9-9049-2ac1d75761d1',
        'vendorid': '8448acd3-aa53-4426-a183-c694ae11ad1a',
        'assignmentprocompanyid': '407'
    }

    try:
        response = requests.post(url, headers=headers, json=milestone_update_body)

        # Raise an exception for HTTP errors
        response.raise_for_status()

        return response
    except requests.exceptions.RequestException as e:
        logger.exception("Error occurred during sendEquusMilestone: %s", str(e))
        return None
    except Exception:
        logger.info('Unexpected network error in sendEquusMilestone.')
        return None


def getNewEvents(api_key, event_type):
    logger.info(f'Running getNewEvents({event_type})')

    url = api_url + "/events/" + event_type
    headers = {
        'Authorization': f'Bearer {api_key}',
        'User-Agent': 'MyApp/1.0',
        'Accept': 'application/json'
    }

    try:
        response = requests.get(url, headers=headers)

        # Raise an exception for HTTP errors
        response.raise_for_status()

        return response
    except requests.exceptions.RequestException as e:
        logger.exception("Error occurred during getNewEvents: %s", str(e))
        return None
    except Exception:
        logger.info('Unexpected network error in getNewEvents.')
        return None

if (__name__ == '__main__'):
    print('test here')
