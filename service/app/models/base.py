import datetime
from sqlalchemy import Column, String, BigInteger, DateTime
from sqlalchemy import create_engine, text, MetaData, select
from sqlalchemy.orm import sessionmaker  # , relationship, backref,
from sqlalchemy.ext.declarative import declarative_base
from app import config
from app.loggers import logger
import urllib


params_string = """
        DRIVER={db_driver};
        SERVER={db_server};
        DATABASE={db_name};
        UID={db_username};
        PWD={db_password};
        """.format(
            db_driver=config.db_driver,
            db_server=config.db_server,
            db_name=config.db_name,
            db_username=config.db_username,
            db_password=config.db_password
            )

params = urllib.parse.quote_plus(params_string)

if config.production_db is True:
    logger.info('Using Production DB')
    engine = create_engine("mssql+pyodbc:///?odbc_connect=%s" % params)
else:
    logger.info('Using In Memory Test DB')
    #engine = create_engine("sqlite:///:memory:")
    engine = create_engine('sqlite:///test.db', echo=True)
    

Base = declarative_base()
Session = sessionmaker(bind=engine)
metadata = MetaData()



class SessionManager():
    def __init__(self):
        self.current_session = Session()

    def current_session_commit(self, RecordType=None, RecordId=None):
        try:
            self.current_session.commit()
        except Exception as e:
            error_message = str(e)
            logger.exception('Exception committing to database')
            addCommitError(RecordType=RecordType, RecordId=RecordId, StackTrace=error_message)
 
    def getNewSession(self):
        self.closeSession()
        self.current_session = Session()

    def closeSession(self):
        self.current_session.close()

    def execute(self, statement, args=None):
        if(args):
            return self.current_session.execute(text(statement),args)
        else:
            return self.current_session.execute(text(statement))    

    def select(self, statement, args=None):
        rows_as_dicts = []
        if(args):
            results = self.current_session.execute(text(statement),args).all()
        else:
            results = self.current_session.execute(text(statement)).all()
        for row in results:
            rows_as_dicts.append(row._mapping)
        return rows_as_dicts

class CommitError(Base):
    __tablename__ = 'pegasus_api_commiterrors'
    __table_args__ = {'implicit_returning': False}  # This is to allow triggers on tables

    # Internal Use Columns
    Error_Id = Column('Id', BigInteger, primary_key=True)
    Record_Type = Column(String)
    Record_Id = Column(String)
    Error_Created = Column(DateTime, default=datetime.datetime.now)
    Stack_Trace = Column(String)

    # API Columns
    def __repr__(self):
        return (self.Id)

def addCommitError(RecordType=None, RecordId=None, StackTrace=None):
    logger.info('Running addCommitError()')
    logger.error('''Error on database commit. Review Error in database.
    Record_Type={RecordType} RecordId={RecordId} '''.format(RecordType=RecordType, RecordId=RecordId))
    commit_error = {
        'Record_Type': RecordType,
        'Record_Id': RecordId,
        'Stack_Trace' : StackTrace
        }
    error = CommitError(**commit_error)
    session_manager = SessionManager()
    session_manager.current_session.add(error)
    session_manager.current_session.commit()
    session_manager.closeSession()

def getTableFields(table_name):
    
    # Reflect the existing table
    
    # Get the specified table
    table = metadata.tables.get(table_name)
    
    if table is None:
        print(f"Table '{table_name}' not found.")
        return []
    
    # Extract column names
    field_names = [col.name for col in table.columns]
    
    return field_names

def getTablesWithPrefix(prefix):
    logger.info('Running getTablesWithPrefix()')
    metadata.reflect(bind=engine,views=True)
    view_prefix = 'v_' + prefix
    view_names = []
    for table_name in metadata.tables.keys():
        if table_name.startswith(view_prefix):
            view_names.append(table_name)
    return(view_names)

def getDataRows(table, event_pk):
    logger.info(f'Running getDataRows({table},{event_pk})')
    session_manager = SessionManager()
    table_name = table
    params = {'value': event_pk}
    select_statement = f"""
        SELECT * FROM {table_name} WHERE event_fk = :value
    """
    result = session_manager.execute(select_statement, params)
    columns = result.keys()
    rows_as_dicts = []
    for row in result:
        row_dict = dict(zip(columns, row))
        rows_as_dicts.append(row_dict)


    return(rows_as_dicts)