import os
import json
from app import config


def logToJson(response_json, id='', type=''):
    rawDataPath = os.environ["APPDATA"] + f"\\DOLAS\\PEGASUS-SERVICES\\{config.service_name}\\JSON\\"
    rawDataFile = os.path.join(rawDataPath, '{type}_{id}.json'.format(id=id, type=type))
    if not os.path.exists(rawDataPath):
        os.makedirs(rawDataPath)
    else:
        pass
    with open(rawDataFile, 'w+') as fp:
        json.dump(response_json, fp, indent=4)
        fp.close()


def logToTxt(response_text, id):
    appDataPath = os.environ["APPDATA"] + f"\\DOLAS\\PEGASUS-SERVICES\\{config.service_name}\\JSON\\"
    rawDataFile = os.path.join(appDataPath, '{id}.txt'.format(id=id))
    with open(rawDataFile, 'a+') as fp:
        fp.write(response_text)
        fp.write('\r\n')
        fp.close()
