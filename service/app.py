import sys
import time
import datetime

try:
    mode = sys.argv[1]
except Exception:
    mode = None

from app import config

import PathSetup
PathSetup.setupPath()  # set up the SYS PATH right
PathSetup.setFileSystem(config.service_name)  # set up the APPDATA Folder

from app.loggers import logger


logger.debug(f'running {config.service_name}...')

def main (mode):
    logger.debug('Running main() in app')
    service_type = config.service_type
    if (mode == '-run'):
        if (service_type=='pegasus-events-receiver'):
            runPegasusEventsReceiver()
        if (service_type=='equus-events-sender'):
            runPegasusEventsSender()
    elif (mode == '-run_debug'):
        if (service_type=='pegasus-events-receiver'):
            runPegasusEventsReceiverDebug()
        if (service_type=='equus-events-sender'):
            runPegasusEventsSenderDebug()
    elif (mode == '-setup_db'):
        setupDB()
    elif (mode == '-test_api'):
        from app import ConfigTests
        ConfigTests.testAPI()
    elif (mode == '-test_db'):
        from app import ConfigTests
        ConfigTests.testDB()
    elif (mode == '-test_smtp'):
        from app import ConfigTests
        ConfigTests.testSMTP()
    else:
        print(f'{mode} not valid')

def setupDB():
    logger.info('Setup DB Starting...')
    try:
        from app import SetupDataBase, db
        db.setupDB()
        SetupDataBase.setItUp(config.service_type)
    except Exception:
        logger.exception('Setup Exception')
    input("Press Enter to quit...")

def runPegasusEventsReceiver():
    logger.info('Service Starting...')
    try:
        from app import ControlFlow
        iteration = 1
        while True:
            try:
                iteration = trackIterations(iteration)
                ControlFlow.runEventsReceiver()
                time.sleep(config.run_frequency)
            except Exception:
                logger.exception('Something went wrong in main control flow:')
                time.sleep(config.run_frequency)
    except Exception:
        logger.critical('Main Loop Exited, Please contact Pegasus Software and Dolas Development to resolve')
        logger.exception('Main Loop Exited')

def runPegasusEventsReceiverDebug():
    logger.info('Running runPegasusEventsReceiverDebug()')
    try:
        config.debug = True
        from app import ControlFlow
        ControlFlow.runEventsReceiver()
    except Exception as e:
        logger.error(e)
    input("Press Enter to quit...")


def runPegasusEventsSender():
    try:
        logger.info('Polling Service Starting...')
        from app import ControlFlow
        iteration = 1
        while True:
            try:
                iteration = trackIterations(iteration)
                ControlFlow.runEventsSender()
                time.sleep(config.run_frequency)
            except Exception:
                logger.exception('Something went wrong in main control flow:')
                time.sleep(config.run_frequency)
    except Exception:
        logger.critical('Main Polling Loop Exited, Please contact Pegasus Software and Dolas Development to resolve')
        logger.exception('Main Polling Loop Exited')


def runPegasusEventsSenderDebug():
    try:
        config.debug = True
        logger.info('Running sender in debug...')
        from app import ControlFlow
        ControlFlow.runEventsSender()
    except Exception:
        logger.exception('Failed to execute runEventsSender')
    input("Press Enter to quit...")



def trackIterations(iteration):
    logger.debug('Running trackIterations()')
    currentDT = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    logger.info('Working on iteration: ' + str(iteration) + ' - ' + currentDT)
    iteration += 1
    return(iteration)
    



if(__name__ == '__main__'):
    if (mode and config.service_name):
        main(mode)
    else:
        logger.error('must have arguments -mode and config_file in the formatt python app.py -mode "service-name.json"')