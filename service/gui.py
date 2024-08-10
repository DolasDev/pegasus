import PathSetup
PathSetup.setupPath()  # set up the SYS PATH right
PathSetup.setFileSystem() # set up the APPDATA Folder

from tkinter import Tk, Entry, Button, IntVar,Checkbutton
from tkinter import ttk
import json
import subprocess
import os
from app.loggers import logger

gui = Tk()
gui.geometry("500x6000")

style = ttk.Style()
style.configure("BW.TLabel", padding=6, background="black", foreground="white")
label_font = ('Helvetica', 10, 'bold')
input_font = ('Helvetica', 10)
title_font = ('Helvetica', 12, 'bold')

fields = {}
current_config = {}
dirname = ''

try:
    dirname = os.path.dirname(os.path.abspath(__file__))
except NameError:  # We are the main py2exe script, not a module
    import sys
    dirname = os.path.dirname(os.path.abspath(sys.argv[0]))

with open(os.path.join(dirname, r'./config.json')) as f:
    current_config = json.load(f)


def save():
    logger.debug('Running save()')
    config_json = {}
    string = ''
    try:
        for key, value in fields.items():
            try:
                config_json[key] = value.get()
            except Exception:
                config_json[key] = value.instate(['selected'])
        new_config = os.path.join(dirname, r'config.json')
        with open(new_config, 'w+') as config:
            json.dump(config_json, config)
        logger.info('Save Successful')
    except Exception:
        string = 'Error Occurred'
        logger.info('Error Occurred')
        logger.exception(string)

    ttk.Label(
        gui,
        text=string,
        style="BW.TLabel", font=label_font).grid(row=12, column=0)


def test_config():
    logger.debug('running test_config()')
    # TODO: test db connection and test ability to grab access
    # tokens and events from the queue
    logger.info('hello test')


# We will need to run something like this to find if a program is running
# subprocess.run(['tasklist -FI "imagename eq bash.exe" -svc'])

def run_app():
    logger.debug('Running run_app()')
    # TODO: it'd be cool if we could see if ,the process is runing or not
    r = subprocess.call('net start pegasus-api-receiver', shell=True)
    logger.info(r)


def setup_app():
    logger.debug('Running setup_app()')
    folder_up = os.path.dirname(os.path.abspath(dirname))
    python_dir = os.path.join(folder_up, r'python368\\')
    python_exe = os.path.join(python_dir, 'python.exe')
    app_path = os.path.join(dirname, r'app.py')
    app_path_quoted = '"' + app_path + '"'
    more_args = '-setup'
    try:
        subprocess.call([python_exe, app_path, more_args])
    except Exception:
        logger.exception('Some issue with setting up DB...')

    nssm = os.path.join(folder_up, r'nssm.exe')

    try:
        logger.info('cleaning up old service')
        subprocess.call([nssm, 'stop', 'pegasus-api-receiver'], cwd=folder_up)
        subprocess.call([nssm, 'remove', 'pegasus-api-receiver', 'confirm'], cwd=folder_up)
    except Exception:
        logger.exception('pegasus-api-receiver service not installed. Installing service now')
    try:
        logger.debug(','.join([nssm,
                               'install',
                               'pegasus-api-receiver',
                               python_exe,
                               app_path_quoted,
                               '-run']))
        subprocess.call([nssm,
                         'install',
                         'pegasus-api-receiver',
                         python_exe,
                         app_path_quoted,
                         '-run'], cwd=folder_up)
        logger.info('pegasus-api-receiver installed successfully')
    except Exception:
        logger.exception('pegasus-api-receiver failed install')
    try:
        subprocess.call([nssm, 'set', 'pegasus-api-receiver', 'Start', 'SERVICE_DELAYED_AUTO_START'], cwd=folder_up)
    except Exception:
        logger.exception('Could not set delayed start')
    try:
        subprocess.call([nssm, 'set', 'pegasus-api-receiver', 'Description', 'Pegasus API to Pegasus DB'], cwd=folder_up)
    except Exception:
        logger.exception('service description failed to update')


api_fields = [
    {
        'label': 'Queue Name',
        'name': 'event_queue_name',
        'default': None
        },
    {
        'label': 'Client Id',
        'name': 'client_id',
        'default': None
        },
    {
        'label': 'Client Secret',
        'name': 'client_secret',
        'default': None
        },
    {
        'label': 'Run Frequencey(minutes)',
        'name': 'run_frequency',
        'default': '5'
        }
]

db_fields = [
    {
        'label': 'SQLServer Host',
        'name': 'db_host',
        'default': '{{Your Server IP or DNS}}'
        },
    {
        'label': 'Pegasus Database Name',
        'name': 'db_instance',
        'default': 'PEGASUS'
        }
]

activation_radios = [
    {
        'label': 'Leads',
        'name': 'getLeadDetail',
        'default': True
        },
    {
        'label': 'Opportunities',
        'name': 'getOpportunityDetail',
        'default': True
        },
    {
        'label': 'Quotes',
        'name': 'getQuoteDetail',
        'default': True
        }
]

gui.title("Pegasus API Configuration")
gui.configure(background='black')
gui.grid_columnconfigure(0, weight=1)
gui.grid_columnconfigure(1, weight=1)


title = ttk.Label(
    gui,
    text="Configure API",
    style="BW.TLabel",
    justify="left", font=title_font).grid(row=0, columnspan=2, pady=(20, 0))


for index, field in enumerate(api_fields):
    ttk.Label(
        gui,
        text=field['label'],
        style="BW.TLabel", font=label_font).grid(row=index + 1, column=0)
    fields[field['name']] = Entry(
        gui,
        font=input_font)
    fields[field['name']].insert(0, current_config[field['name']])
    fields[field['name']].grid(row=index + 1, column=1, sticky="we", padx=30)

title = ttk.Label(
    gui,
    text="Configure Database",
    style="BW.TLabel",
    justify="left", font=title_font).grid(row=5, columnspan=2, pady=(20, 0))

for index, field in enumerate(db_fields):
    ttk.Label(
        gui,
        text=field['label'],
        style="BW.TLabel",
        font=label_font).grid(row=index + 6, column=0)
    fields[field['name']] = Entry(
        gui,
        font=input_font)
    fields[field['name']].insert(0, current_config[field['name']])
    fields[field['name']].grid(row=index + 6, column=1, sticky="we", padx=30)

title = ttk.Label(
    gui,
    text="Run Processes",
    style="BW.TLabel",
    justify="left", font=title_font).grid(row=8, columnspan=2, pady=(20, 0))

for index, field in enumerate(activation_radios):
    var = IntVar()
    fields[field['name']] = ttk.Checkbutton(
        gui,
        text=field['label'],
        style="BW.TLabel", variable=var)
    fields[field['name']].state(['selected'])
    if current_config is True:
        fields[field['name']].state(['selected'])
    fields[field['name']].grid(row=index + 9, column=1, sticky="we", padx=30)

Button(
    gui,
    text="Save",
    font=label_font,
    width=15,
    command=lambda: save()
).grid(
    row=12,
    pady=(10, 0),
    column=0)

Button(
    gui,
    text="Test Config",
    font=label_font,
    width=15,
    command=lambda: test_config()
).grid(
    row=12,
    pady=(20, 0),
    column=1)

Button(
    gui,
    text="Run App",
    font=label_font,
    width=15,
    command=lambda: run_app()
).grid(
    row=14,
    pady=(10, 0),
    column=0)

Button(
    gui,
    text="SetUp Pegasus API Receiver",
    font=label_font,
    width=15,
    command=lambda: setup_app()
).grid(
    row=14,
    pady=(20, 0),
    column=1)

gui.mainloop()
