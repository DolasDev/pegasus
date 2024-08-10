module.exports = [
    {
        'label': 'Service Type',
        'name': 'service_type',
        'defaultVal': {'label':'Pegasus Events Receiver', 'value':'pegasus-events-receiver'},
        'type': 'select',
        'options':[
            {'label':'Pegasus Events Receiver', 'value':'pegasus-events-receiver'},
            {'label':'Equus Events Sender', 'value':'equus-events-sender'}
        ]
    },
    {
        'label': 'Service Name',
        'name': 'service_name',
        'defaultVal': ''
    },
    {
        'label': 'API base URL',
        'name': 'api_base_url',
        'defaultVal': "https://"
    },
    {
        'label': 'API Auth Endpoint',
        'name': 'api_auth_url',
        'defaultVal': "https://"
    },
    {
        'label': 'Run Frequency (Minutes)*',
        'name': 'run_frequency',
        'defaultVal': 5
    },
    {
        'label': 'Client Id*',
        'name': 'client_id',
        'defaultVal': ''
    },
    {
        'label': 'Client Secret*',
        'name': 'client_secret',
        'defaultVal': ''
    },
    {
        'label': 'Server Admin Username',
        'name': 'setup_db_username',
        'defaultVal': ''
    },
    {
        'label': 'Server Admin Password',
        'name': 'setup_db_password',
        'type': 'password',
        'defaultVal': ''
    },
    {
        'label': 'Pegasus DB Host*',
        'name': 'db_host',
        'defaultVal': ''
    },
    {
        'label': 'Pegasus DB Instance*',
        'name': 'db_instance',
        'defaultVal': ''
    },
    {
        'label': 'Pegasus DB Name',
        'name': 'pegasus_db_name',
        'defaultVal': 'PEGASUS'
    },
    {
        'label': 'Use SMTP',
        'name': 'activate_smtp',
        'defaultVal': false,
        'type': 'toggle',
    },
    {
        'label': 'SMTP Host',
        'name': 'smtp_mailhost_server',
        'defaultVal': ''
    },
    {
        'label': 'SMTP Port',
        'name': 'smtp_mailhost_port',
        'defaultVal': '587'
    },
    {
        'label': 'SMTP From Address',
        'name': 'smtp_fromaddr',
        'defaultVal': ''
    },
    {
        'label': 'SMTP To Address',
        'name': 'smtp_toaddr',
        'defaultVal': ''
    },
    {
        'label': 'SMTP Subject',
        'name': 'smtp_subject',
        'defaultVal': ''
    },
    {
        'label': 'SMTP Username',
        'name': 'smtp_credentials_usr',
        'defaultVal': ''
    },
    {
        'label': 'SMTP Password',
        'name': 'smtp_credentials_pwd',
        'type': 'password',
        'defaultVal': '',
    },
    {
        'label': 'Use Pegasus Database',
        'name': 'use_peg_database',
        'defaultVal': false,
        'type': 'toggle',
    }
]