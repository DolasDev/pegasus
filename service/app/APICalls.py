from oauthlib.oauth2 import BackendApplicationClient, TokenExpiredError
from requests_oauthlib import OAuth2Session
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
logger.debug('API Calls Directed at Production')


# ADE - Access Request Description

def addCallErrorEvent(LeadId=None, OpportunityId=None, QuoteId=None):
    logger.debug('Running addCallErrorEvent()')
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
    logger.debug('Running accessRequest()')
    try:
        token_url = api_auth_url
        logger.debug('Authenticating with: ' + token_url)
        logger.debug('client_id:'+client_id+ ', client_secret:'+client_secret)
        auth = HTTPBasicAuth(client_id, client_secret)
        client = BackendApplicationClient(client_id=client_id)
        oauth = OAuth2Session(client=client)
        token = oauth.fetch_token(token_url=token_url, auth=auth)
        logger.debug('Retrieved Token Successfully')
        return(token)
    except Exception:
        logger.exception('Failed to Authenticate, possible timeout')

def equusAccessRequest(client_id, client_secret):
    logger.debug('Running equusAccessRequest()')
    params = {
    'clientId': client_id,
    'clientSecret': client_secret
    }
    try:
        token_url = api_auth_url
        logger.debug('Authenticating with: ' + token_url)
        logger.debug('client_id:'+client_id+ ', client_secret:'+client_secret)
        response = requests.post(token_url, params=params)
        logger.debug('Retrieved Token Successfully')
        return(response.json()['access_token'])
    except Exception:
        logger.exception('Failed to Authenticate, possible timeout')


def deleteEvent(client_id, client_secret, token, event_id):
    logger.debug('Running deleteEvent()')
    try:
        try:
            url = api_url + "/events/" + event_id
            client = OAuth2Session(client_id, token=token)
            r = client.delete(url)
            return(r)
        except TokenExpiredError:
            token = accessRequest(client_id, client_secret)
            client = OAuth2Session(client_id, token=token)
            r = client.delete(url)
            return(r)
    except OSError:
        logger.debug('Timeout error on deleteEvent')
        return(None)
    except Exception:
        logger.debug('Some sort of network error on deleteEvent')
        return(None) 

def sendEquusMilestone(client_id, client_secret, token, mileston_update_body):
    logger.debug('Running sendEquusMilestone()')
    logger.debug(f"token: {token}")
    headers = {
    'Authorization': f'Bearer {token}',
    'User-Agent': 'MyApp/1.0',
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'assignmentproinstanceid': '09b18e2b-7f06-4dd9-9049-2ac1d75761d1',
    'vendorid':'8448acd3-aa53-4426-a183-c694ae11ad1a',
    'assignmentprocompanyid':'407'
    }
    try:
        try:
            url = api_url
            r = requests.post(url, headers=headers, json=mileston_update_body)
            return(r)
        except TokenExpiredError:
            token = accessRequest(client_id, client_secret)
            client = OAuth2Session(client_id, token=token)
            client.headers.update(headers)
            r = client.post(url, json=mileston_update_body)
            return(r)
        except Exception:
            logger.debug('Some sort of network error on sendEquusMilestone')
            return(None)
    except OSError:
        logger.debug('Timeout error on sendEquusMilestone')
        return(None)
    except Exception:
        logger.debug('Some sort of network error on sendEquusMilestone')
        return(None)    


def getNewEvents(client_id, client_secret, token):
    logger.debug('Running getNewEvents()')
    try:
        try:
            url = api_url + "/events"
            client = OAuth2Session(client_id, token=token)
            r = client.get(url)
            return(r)
        except TokenExpiredError:
            token = accessRequest(client_id, client_secret)
            client = OAuth2Session(client_id, token=token)
            r = client.get(url)
            return(r)
    except OSError:
        logger.debug('Timeout error on getNewEvents')
        return(None)
    except Exception:
        logger.debug('Some sort of network error on getNewEvents')
        return(None)    

if (__name__ == '__main__'):
    print('test here')
