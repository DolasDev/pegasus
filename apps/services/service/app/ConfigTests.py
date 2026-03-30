from app.loggers import logger, config


def testAPI():
    try:
        from app import APICalls
        token = APICalls.accessRequest(config.client_id, config.client_secret)
        logger.info(token)
    except ImportError:
        logger.error('Failed to import modules')
        logger.exception('Application error... failed to import modules')
    except Exception:
        logger.error('API Error, failed to aquire token. Check Credentials')
        logger.exception('API Error, failed to aquire token. Check Credentials')


def testDB():
    try:
        pass
    except Exception:
        logger.exception('Database Config Error - Could Not Connect')


def testSMTP():
    try:
        logger.critical("""
        Hello, This is a test message from the Pegasus API Receiver.
        If you recieved this message, the SMTP setup is valid!
        Critical error notifications will be sent to this email address.""")
    except Exception:
        logger.exception('There was a problem throwing the above error Critical Error^^^')
