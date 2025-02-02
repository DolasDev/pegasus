from requests.auth import HTTPBasicAuth
import requests
from app.loggers import logger
from app.models import base, Events
try:
    from app import config
except Exception:
    import config

api_url = config.api_base_url
api_auth_url=config.api_auth_url
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


def accessRequest(client_id, client_secret):
    logger.info('Running accessRequest()')
    try:
        token_url = api_auth_url  # Ensure api_auth_url is defined
        logger.info('Authenticating with: ' + token_url)
        logger.info('client_id: ' + client_id + ', client_secret: ' + client_secret)
        
        # Define the request payload and headers
        payload = {'grant_type': 'client_credentials'}
        auth = HTTPBasicAuth(client_id, client_secret)
        
        # Make the POST request
        response = requests.post(token_url, data=payload, auth=auth)
        
        # Raise an exception for HTTP errors
        response.raise_for_status()
        
        # Parse and return the token
        token = response.json()
        logger.info('Retrieved Token Successfully')
        return token
    except requests.exceptions.RequestException as e:
        logger.exception('Failed to Authenticate: %s', str(e))
        return None

def equusAccessRequest(client_id, client_secret):
    logger.info('Running equusAccessRequest()')
    params = {
    'clientId': client_id,
    'clientSecret': client_secret
    }
    try:
        token_url = api_auth_url
        logger.info('Authenticating with: ' + token_url)
        logger.info('client_id:'+client_id+ ', client_secret:'+client_secret)
        response = requests.post(token_url, params=params)
        logger.info('Retrieved Token Successfully')
        return(response.json()['access_token'])
    except Exception:
        logger.exception('Failed to Authenticate, possible timeout')

    
def deleteEvent(client_id, client_secret, token, event_id):
    logger.info('Running deleteEvent()')
    try:
        url = api_url + "/events/" + event_id  # Ensure `api_url` is defined
        headers = {"Authorization": f"Bearer {token}"}
        
        # Attempt to delete the event
        response = requests.delete(url, headers=headers)
        
        # Check if the token has expired or another error occurred
        if response.status_code == 401:  # Unauthorized, possibly token expired
            logger.info("Token expired, requesting new token.")
            token_response = accessRequest(client_id, client_secret)
            
            if token_response:
                token = token_response.get("access_token")
                headers = {"Authorization": f"Bearer {token}"}
                response = requests.delete(url, headers=headers)
            else:
                logger.info("Failed to refresh token.")
                return None
        
        # Raise an exception for HTTP errors
        response.raise_for_status()
        
        return response
    except requests.exceptions.RequestException as e:
        logger.exception("Error occurred during deleteEvent: %s", str(e))
        return None
    except Exception:
        logger.info('Some sort of network error on deleteEvent')
        return None

def sendEquusMilestone(client_id, client_secret, token, milestone_update_body):
    logger.info('Running sendEquusMilestone()')
    logger.info(f"Token: {token}")
    
    url = api_url  # Ensure `api_url` is defined
    headers = {
        'Authorization': f'Bearer {token}',
        'User-Agent': 'MyApp/1.0',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'assignmentproinstanceid': '09b18e2b-7f06-4dd9-9049-2ac1d75761d1',
        'vendorid': '8448acd3-aa53-4426-a183-c694ae11ad1a',
        'assignmentprocompanyid': '407'
    }
    
    try:
        # Attempt to send the milestone update
        response = requests.post(url, headers=headers, json=milestone_update_body)
        
        # Handle token expiration (401 Unauthorized)
        if response.status_code == 401:  # Token expired or invalid
            logger.info("Token expired, requesting a new token.")
            token_response = accessRequest(client_id, client_secret)
            
            if token_response:
                token = token_response.get("access_token")
                headers['Authorization'] = f'Bearer {token}'
                response = requests.post(url, headers=headers, json=milestone_update_body)
            else:
                logger.info("Failed to refresh token.")
                return None
        
        # Raise an exception for HTTP errors
        response.raise_for_status()
        
        return response
    except requests.exceptions.RequestException as e:
        logger.exception("Error occurred during sendEquusMilestone: %s", str(e))
        return None
    except Exception:
        logger.info('Unexpected network error in sendEquusMilestone.')
        return None 


def getNewEvents(client_id, client_secret, token, event_type):
    logger.info(f'Running getNewEvents({event_type})')
    
    url = api_url + "/events/" + event_type # Ensure `api_url` is defined
    headers = {
        'Authorization': f'Bearer {token}',
        'User-Agent': 'MyApp/1.0',
        'Accept': 'application/json'
    }
    
    try:
        # Attempt to fetch new events
        response = requests.get(url, headers=headers)
        
        # Handle token expiration (401 Unauthorized)
        if response.status_code == 401:  # Token expired or invalid
            logger.info("Token expired, requesting a new token.")
            token_response = accessRequest(client_id, client_secret)
            
            if token_response:
                token = token_response.get("access_token")
                headers['Authorization'] = f'Bearer {token}'
                response = requests.get(url, headers=headers)
            else:
                logger.info("Failed to refresh token.")
                return None
        
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
