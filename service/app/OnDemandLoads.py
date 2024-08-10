import csv
from tkinter import filedialog
from tkinter import Tk


def loadLeads():
    try:
        csvToLoad = selectFile()
        ids = loadLeadsCSV(csvToLoad)
        logger.info(str(len(ids)))
        token = APICalls.accessRequest(config.client_id, config.client_secret)
        if token is not None:
            ControlFlow.pipeInLeads(ids, token)
        else:
            raise ValueError('Could not Authenticate... aborting')
    except Exception:
        logger.exception('Loading Leads Error')


def loadOppootunities():
    try:
        csvToLoad = selectFile()
        ids = loadOpportunitiesCSV(csvToLoad)
        logger.info(str(len(ids)))
        token = APICalls.accessRequest(config.client_id, config.client_secret)
        if token is not None:
            ControlFlow.pipeInOpportunities(ids, token)
        else:
            raise ValueError('Could not Authenticate... aborting')
    except Exception:
        logger.exception('Loading Opportinites Error')


def selectFile():
    # root = Tk()
    # root.filename = filedialog.askopenfilename(
    Tk().withdraw()
    filename = filedialog.askopenfilename(
        initialdir="/",
        title="Select file",
        filetypes=(("csv files", "*.csv"), ("all files", "*.*")))
    return(filename)


def loadLeadsCSV(leads_export_path):
    logger.debug('Running loadLeadsCSV()')
    lead_ids = []
    with open(leads_export_path, mode='r') as leads_export:
        csv_reader = csv.DictReader(leads_export)
        for row in list(csv_reader):
            record_id = '10x'+row['Record ID']
            # createLoadEvent(LeadId=record_id, OpportunityId=None, QuoteId=None)
            lead_ids.append(record_id)
    return(lead_ids)


def loadOpportunitiesCSV(opportunity_export_path):
    logger.debug('Running loadOpportunitiesCSV()')
    opportunity_ids = []
    with open(opportunity_export_path, mode='r') as oppotunities_export:
        csv_reader = csv.DictReader(oppotunities_export)
        for row in list(csv_reader):
            record_id = '46x'+row['Record ID']
            opportunity_ids.append(record_id)
            # createLoadEvent(LeadId=None, OpportunityId=record_id, QuoteId=None)
    return(opportunity_ids)


def createLoadEvent(LeadId=None, OpportunityId=None, QuoteId=None): # Needs recode for Pegasus API Events (may not be needed)
    session_manager = base.SessionManager()
    logger.debug('Running createLoadEvent()')
    load_event = {
        'Interface_Status': 'Inbound',
        'Processed_Status': 'New',
        'Type': 'Pegasus API Event - Manual Load',
        'LeadId': LeadId,
        'OpportunityId': OpportunityId,
        'QuoteId': QuoteId
        }
    event_entity = Events.Event(**load_event)
    session_manager.current_session.add(event_entity)
    session_manager.current_session_commit()
    session_manager.closeSession()


if __name__ == '__main__':
    import sys
    import os

    def setupPath():
        print('Running setupPath()')
        dirname = os.path.dirname(__file__)
        path_add_lis = []
        path_add_lis.append(dirname)  # \pegasus-api-receiver\pegasus-api-receiver
        path_add_lis.append(os.path.join(dirname, r'../python368'))  # \pegasus-api-receiver\python368
        path_add_lis.append(os.path.join(dirname, r'../python368/site-packages'))  # \pegasus-api-receiver\python368\site-packages
        path_add_lis.append(os.path.join(dirname, r'../python368/tcl8.6'))  # \pegasus-api-receiver\python368\tcl8.6
        path_add_lis.append(os.path.join(dirname, r'../'))
        for path in path_add_lis:
            sys.path.append(path)
            print(path, ' added to path')

    setupPath()

    from models import Events, base
    from loggers import logger
    from app import ControlFlow
    loadLeads()
    loadOppootunities()
else:
    from app.models import Events, base
    from app.loggers import logger
    from app import ControlFlow, APICalls, config
