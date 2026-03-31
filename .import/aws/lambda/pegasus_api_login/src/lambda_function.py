import json
from oauthlib.oauth2 import BackendApplicationClient
from requests_oauthlib import OAuth2Session
from requests.auth import HTTPBasicAuth
import base64
import time
from datetime import datetime, timedelta, timezone

# Get current UTC time
now_utc = datetime.now(timezone.utc)

# Add 2 hours
future_utc = now_utc + timedelta(hours=2)

# Convert to Unix timestamp (float with fractions of a second)
future_timestamp = future_utc.timestamp()


def xor_cipher(data: bytes, key: bytes) -> bytes:
    return bytes([b ^ key[i % len(key)] for i, b in enumerate(data)])



def accessRequest(client_id, client_secret):
    token_url = r"https://pegasus-api.auth.us-east-1.amazoncognito.com/oauth2/token"
    auth = HTTPBasicAuth(client_id, client_secret)
    client = BackendApplicationClient(client_id=client_id)
    oauth = OAuth2Session(client=client)
    token = oauth.fetch_token(token_url=token_url, auth=auth)
    return(token)
 
def lambda_handler(event, context):
    
    auth_header = event['headers']['authorization']
    b64_id_and_secret = auth_header.replace('Basic','').strip()
    id_and_secret = base64.b64decode(b64_id_and_secret).decode('utf-8').split(':')
    client_id=id_and_secret[0]
    client_secret=id_and_secret[1]
    
    # authn_response=accessRequest(client_id, client_secret)
    
    token = base64.b64encode(xor_cipher(client_id.encode('utf-8'),client_secret.encode('utf-8'))).decode('utf-8')
    authn_response = {"access_token": token, "expires_in": 3600, "token_type": "Bearer", "expires_at": future_timestamp}
    
    # Build our response object as a Python dict object
    response = dict()
    response["statusCode"] = 200
    response["body"] = json.dumps(authn_response)
 
    return(response)
