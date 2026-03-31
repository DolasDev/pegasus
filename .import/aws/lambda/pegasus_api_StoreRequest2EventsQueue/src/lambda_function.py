import boto3
import json
import uuid
import time
from decimal import Decimal
from time import asctime
from datetime import datetime, timezone

# Get the current UTC time
utc_now = datetime.utcnow().replace(tzinfo=timezone.utc)

# Format the UTC time as an ISO string
utc_iso_string = utc_now.now()

localtime = asctime()

print('Loading function')
dynamo = boto3.client('dynamodb')

def clean_json(json_string):
    """
    Clean a JSON string by removing unnecessary spaces and new line characters.

    Args:
        json_string (str): JSON string to clean.

    Returns:
        str: Cleaned JSON string.
    """
    # Load the JSON string into a Python object and then convert it back to a JSON string
    # with separators specified to remove unnecessary spaces and new line characters.
    cleaned_json_string = json.dumps(json.loads(json_string), separators=(',', ':'))

    return cleaned_json_string
    

def respond(err, res=None, item=None):
    if err:
        print("Error: " + str(err))
    else:
        print("Success:")
        print("Dynamo Response: " + str(res))
        print("API Response Data: " + str(item))
    return {
        'statusCode': '400' if err else '200',
        'body': json.dumps({
            'status': '400' if err else '200',
            'message': str(err) if err else 'Operation successful',
            'data': item if item else {},
            'errors':[{'field':'tbd','message':'validation tbd'}] if err else []
        }),
        'headers': {
            'Content-Type': 'application/json'
        }
    }


def lambda_handler(event, context):
    random_uuid = str(uuid.uuid4())
    try:
        '''Demonstrates a simple HTTP endpoint using API Gateway. You have full
        access to the request and response payload, including headers and
        status code.
    
        To scan a DynamoDB table, make a GET request with the TableName as a
        query string parameter. To put, update, or delete an item, make a POST,
        PUT, or DELETE request respectively, passing in the payload to the
        DynamoDB API as a JSON body.
        '''
        print("Received event: " + json.dumps(event, indent=2))
    
        operation = event['httpMethod']
        stage = event["requestContext"]["stage"]
        if stage == 'default': 
            stage = 'dev'
        elif stage == 'prod': 
            stage = 'prod_depricated'
        
        print( "operation: " + operation)
        print( "stage: " + stage)

        operations = {
            'DELETE': lambda dynamo, x: dynamo.delete_item(**x),
            'GET': lambda dynamo, x: dynamo.scan(**x),
            'POST': lambda dynamo, x: dynamo.put_item(**x),
            'PUT': lambda dynamo, x: dynamo.update_item(**x),
        }
    
        payload = {"TableName": f"hhg_api_events_{stage}"}
        #payload = {"TableName": f"pegasus_api_events" }
        
        auth_header = event['headers'].get('authorization')  # lowercase key
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header.split(' ')[1]
            print("Bearer token:", token)
            # use the token (e.g. validate, call another service)
        else:
            raise ValueError("No Bearer token found")

        client_id = token

        #client_id = event['requestContext']['authorizer']['claims']['client_id']
        path_parameters = event.get('pathParameters', {})
        # Access a specific parameter by its name
        customer_app_id = path_parameters.get('customer_app_id')
        
        if not operation in operations:
            raise ValueError('Unsupported method "{}"'.format(operation))
        if operation == 'GET':
            item = None
            payload["Limit"] = 10
            print('made it to get request')
        if operation == 'POST':
            print('posting...')
            print(f"event_path: {event['path']}")
            type = 'orders_create_'+customer_app_id
            print(f"event_type={type}")
            item = {
                'event_id': {'S': random_uuid},
                'event_type' : {'S': type if type is not None else 'unknown' },
                'event_publisher': {'S': client_id},
                'event_data' : {'S': clean_json(event['body'])},
                'event_status': {'S':'NEW'},
                'event_datetime': {'S': localtime},
                # 'event_epoch': { 'N': int(time.time() * 1000) }
                #'event_stage':{'S': stage}
            }
            payload["Item"] = item
        return respond(None, operations[operation](dynamo, payload), item)
    except Exception as e:
        print(f"Error: {str(e)}")
        return respond(e, None, payload)