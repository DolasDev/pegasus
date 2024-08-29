import json
import re
import dateutil.parser
from app.loggers import logger
#  Response handlers take in response objects and return handled response objects with 3 properties status, Errors(a list), and response_dict(a dict)


class ProcessedResponse():
    def __init__(self, raw_json, response_dict, Id):
        logger.info('Instantiating ProcessedResponse')
        self.raw_dict = raw_json
        #self.response_dict = fixDataTypes(response_dict) #SD - Not needed since all strings
        self.response_dict = response_dict
        self.Id = Id  # This removes random characters from the front of the Ids
        self.status = 'Passed'
        self.errors = []  # No application for this yet but here is where we can store error to process in some other table if needed?


def fixDataTypes(response_dict):
    logger.info('Running fixDataTypes()')
    working_dict = response_dict
    for key, value in working_dict.items():
        if isinstance(value, dict):
            fixDataTypes(value)
        elif isinstance(value, list):
            for item in value:
                fixDataTypes(item)
        elif value is None or value == '':
            working_dict[key] = None
        else:
            try:  # First try to convert the value to an integer. fields with 'number' in the name will be cleaned of non numeric characters
                working_dict[key] = cleanNamedNumberValues(value)
                if value[0] != '0':
                    working_dict[key] = int(value)
            except Exception:
                    try:
                        if value[0] != '0':
                            working_dict[key] = dateutil.parser.parse(value)
                        else:
                            pass
                    except Exception:
                        try:
                            if value[0] != '0' and lower(value) != 'nan':
                                working_dict[key] = float(value)
                            else:
                                pass
                        except Exception:
                            working_dict[key] = removeNonAscii(value)
    return(working_dict)


def cleanNamedNumberValues(string_to_clean):
    try:
        if ('number' in string_to_clean.lower()):
            logger.info('Cleaning Numeric Value')
            cleaned_string = re.sub('[^0-9]', '', string_to_clean)
            return(cleaned_string)
        else:
            return(string_to_clean)
    except Exception:
        return(string_to_clean)


def removeNonAscii(string_to_clean):
    try:
        cleaned_string = ''.join(character for character in string_to_clean if ord(character) < 126 and ord(character) > 31)
        return(cleaned_string)
    except Exception:
        return(string_to_clean)


def getProcessedResponse(response_object, Id=None):
    logger.info('Running getProcessedResponse()')
    raw_json = response_object.json()
    try:
        response_dict = json.loads(response_object.text,object_hook=explicitDecode)
    except Exception:  # This is for handling the test files
        logger.exception('Failed to load response into JSON')
        logger.info('response_object.text is of type ' + str(type(response_object.text)))

    processed_response = ProcessedResponse(raw_json, response_dict, Id)
    return(processed_response)

def parseEqussMilestoneResponse(response_object):
    logger.info('Running parseEqussMilestoneResponse()')
    raw_json = response_object.json()
    try:
        response_dict = json.loads(response_object.text)
        # Access the ErrorMessages array
        error_messages = response_dict["ErrorMessages"]
        parsed_error_messages = []

        # Iterate over each error message
        for error_message in error_messages:
            # Extract the embedded JSON from the error message
            start_index = error_message.find('{')
            end_index = error_message.rfind('}') + 1
            embedded_json_str = error_message[start_index:end_index]
            # Parse the embedded JSON
            stripped_error_message = error_message[0:start_index]
            embedded_json = json.loads(embedded_json_str)
            paresed_error_message = {'error_message':stripped_error_message, 'error_details':embedded_json}
            parsed_error_messages.append(paresed_error_message)

        response_dict["ErrorMessages"] = parsed_error_messages
        return(response_dict)
    except Exception:  # This is for handling the test files
        logger.exception('Failed to load response into JSON')
        logger.info('response_object.text is of type ' + str(type(response_object.text)))
    return(raw_json)

def explicitDecode(loaded_dict):
    working_dict = loaded_dict
    for key, value in loaded_dict.items():
        if isinstance(value, dict):
            explicitDecode(value)
        elif isinstance(value, list):
            for item in value:
                explicitDecode(item)
        else:
            try:
                    # TODO UN-STUB
                #datatype = DATA_TYPE_LOOKUP[key]
                datatype = DATA_TYPE_LOOKUP['String']
                if value is None or value == '':
                    working_dict[key] = None
                elif datatype == 'string':
                    working_dict[key] = removeNonAscii(value)
                elif datatype == 'datetime':
                    try:
                        working_dict[key] = dateutil.parser.parse(value)
                    except TypeError:
                        pass
                    except Exception as e:
                        logger.info('Conversion of {key} to datetime failed'.format(key=key))
                        logger.info(e)
                        working_dict[key] = None
                elif datatype == 'int':
                    try:
                        working_dict[key] = int(value)
                    except Exception as e:
                        logger.info('Conversion of {key} to int failed'.format(key=key))
                        logger.info(e)
                elif datatype == 'float':
                    try:
                        working_dict[key] = float(value)
                    except Exception as e:
                        logger.info('Conversion of {key} to float failed'.format(key=key))
                        logger.info(e)
            except Exception as e:
                logger.info('lookup for {key} in DATA_TYPE_LOOKUP failed. Datatype not explicitly defined'.format(key=key))
            
    return(working_dict)

DATA_TYPE_LOOKUP = {
    'String':'string',
    'Id' : 'string'
}