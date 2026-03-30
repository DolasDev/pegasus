import logging
from logging.handlers import SMTPHandler, RotatingFileHandler
from app import config
import os, sys

# Create a custom logger
logger = logging.getLogger(__name__)
service_name = config.service_name



# Define Log File Paths
debug_logfile = os.environ["APPDATA"] + f"\\DOLAS\\PEGASUS-SERVICES\\{service_name}\\LOGS\\debug.log"
error_logfile = os.environ["APPDATA"] + f"\\DOLAS\\PEGASUS-SERVICES\\{service_name}\\LOGS\\error.log"
critical_logfile = os.environ["APPDATA"] + f"\\DOLAS\\PEGASUS-SERVICES\\{service_name}\\LOGS\\critical.log"

# Create handlers
debug_handler = logging.StreamHandler(sys.stdout)
debug_handler = RotatingFileHandler(debug_logfile, mode='a', maxBytes=10*1024*1024, backupCount=5, encoding=None, delay=0)
info_handler = logging.StreamHandler(sys.stdout)
error_handler = logging.StreamHandler()
exception_handler = RotatingFileHandler(error_logfile, mode='a', maxBytes=10*1024*1024, backupCount=5, encoding=None, delay=0)
critical_handler = RotatingFileHandler(critical_logfile, mode='a', maxBytes=10*1024*1024, backupCount=5, encoding=None, delay=0)
smtp_handler = SMTPHandler(
    mailhost=(config.smtp_mailhost_server, config.smtp_mailhost_port),
    fromaddr=config.smtp_fromaddr,
    toaddrs=[config.smtp_toaddrs],
    subject=config.smtp_subject,
    credentials=(config.smtp_credentials_usr, config.smtp_credentials_pwd),
    secure=()
)

# Set level of hanlders

debug_handler.setLevel(logging.DEBUG)
info_handler.setLevel(logging.INFO)
exception_handler.setLevel(logging.ERROR)
error_handler.setLevel(logging.ERROR)
critical_handler.setLevel(logging.CRITICAL)
smtp_handler.setLevel(logging.ERROR)

# Create formatters and add it to handlers
info_format = logging.Formatter('%(name)s - %(levelname)s - %(message)s')
debug_format = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s', datefmt='%Y-%m-%d %H:%M:%S')
smtp_format = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')

debug_handler.setFormatter(debug_format)
info_handler.setFormatter(info_format)
exception_handler.setFormatter(debug_format)
critical_handler.setFormatter(debug_format)
smtp_handler.setFormatter(smtp_format)
error_handler.setFormatter(debug_format)

# Add handlers to the logger
logger.addHandler(debug_handler)
logger.addHandler(info_handler)
logger.addHandler(exception_handler)
logger.addHandler(critical_handler)
logger.addHandler(error_handler)
if config.activate_smtp:
    logger.addHandler(smtp_handler)
else:
    pass

logger.setLevel(logging.DEBUG)

'''
# Remove SMTP handler if it exists STUB TODO
for handler in logger.handlers[:]:
    if isinstance(handler, logging.handlers.SMTPHandler):
        logger.removeHandler(handler)
'''