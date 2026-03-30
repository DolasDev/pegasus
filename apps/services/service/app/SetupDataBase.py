import importlib
from app.models.base import Base, engine
from app.models import Events, EquusLeads # keep these here. They need to be initialized

from app.loggers import logger

def setItUp(service_type):
    logger.info('Setting Up Tables in DB')
    # TODO Add support for only setting up specific config in db
    """
    models = {
        'equus-events-receiver' : 'EquusLeads',
        'equus-events-sender':'EquusMilestones',
        'qlab-events-receiver':'TODO'
    }
    fq_models = 'app.models.'+ models[service_type]
    logger.info(f"Setting Up integration Tables")
    test = importlib.import_module(fq_models) #I 'think' this needs to stay here to instantiate the models though that might not be true since I import up top
    """
    
    Base.metadata.create_all(engine, checkfirst=True)
    
    #Set up views seperately
    try:
        from app.models import EquusMilestones # checkfirst=True limitation on view so they must be imported
        Base.metadata.create_all(engine, checkfirst=True)
    except Exception as e:
        logger.info(f'One or more views already exists. Updates to views will need to be manually completed')
        logger.debug(f'{e}')
    
    logger.info('Tables Are Set Up')