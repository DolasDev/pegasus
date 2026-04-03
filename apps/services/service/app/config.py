import sys
import json

try:
    config_file = sys.argv[2]
except Exception:
    config_file = None

# DEBUGGING
debug = False
production_db = True

# SERVICE CREDENTIALS
db_username = 'pegasus_services'
db_password = 'pegasus'
db_driver = '{ODBC Driver 11 for SQL Server}'

# LOAD CONFIG FILE
with open(config_file) as f:
    data = json.load(f)
    
    if data['use_peg_database']:
        db_name = data['pegasus_db_name']
    else:
        db_name = 'PEGASUS_SERVICES'

    # ServiceInfo
    service_name = data['service_name']
    service_type = data['service_type']
    event_type = data['event_type']
    input_format = data.get('input_format', 'json')
    
    # API Config
    api_key = data['api_key']
    api_base_url = data['api_base_url']

    run_frequency = float(data['run_frequency']) * 60

    # DATABASE
    db_server = data['db_host'] + '\\' + data['db_instance']
    db_setup_username = data['setup_db_username']
    db_setup_password = data['setup_db_password']
    db_pegasus_db_name = data['pegasus_db_name']

    # LOGGING & SMTP
    log_level = ''  # TODO can possibly use this to change the log level to error... probably overkill
    activate_smtp = data['activate_smtp']
    smtp_mailhost_server = data['smtp_mailhost_server']  # 'smtp.gmail.com'
    smtp_mailhost_port = data['smtp_mailhost_port']  # '587'
    smtp_fromaddr = data['smtp_fromaddr']
    smtp_toaddrs = data['smtp_toaddr']
    smtp_subject = data['smtp_subject']
    smtp_credentials_usr = data['smtp_credentials_usr']
    smtp_credentials_pwd = data['smtp_credentials_pwd']



