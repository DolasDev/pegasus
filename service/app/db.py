# Use ODBC Driver 11 for SQL Server!!! ###
from app.loggers import logger


def setupDB():
    logger.debug('Running setupDB')
    cxn = connect_db()
    cursor = cxn.cursor()

    create_db_sql = """
                    IF NOT EXISTS(select * from sys.databases where name='{db_name}')
                    CREATE DATABASE {db_name}
                    """.format(db_name=config.db_name)

    create_login_sql = """
                      IF NOT EXISTS(select * from sys.syslogins where name='{db_username}')
                      CREATE LOGIN {db_username}
                      WITH
                        PASSWORD = '{db_password}',
                        DEFAULT_DATABASE = [{db_name}],
                        CHECK_POLICY = OFF
                      """.format(
                          db_name=config.db_name,
                          db_username=config.db_username,
                          db_password=config.db_password)

    use_pegasus_api_integration = """
                          USE [{db_name}]
                          """.format(db_name=config.db_name)

    create_user_sql = """
                      IF NOT EXISTS(select * from sys.database_principals where name='{db_username}')
                      CREATE USER [{db_username}] FOR LOGIN [{db_username}]
                      """.format(db_username=config.db_username)

    add_owner_sql = """
                    ALTER ROLE [db_owner] ADD MEMBER [{db_username}]
                    """.format(db_username=config.db_username)

    try:
        logger.info("Setting up DB...")
        cursor.execute(create_db_sql)
        logger.info("DB Setup Successful")
    except Exception:
        logger.exception('DB Setup Failed')
    try:
        logger.info("Setting up Login...")
        cursor.execute(create_login_sql)
        logger.info("Login Setup Successful")
    except Exception:
        logger.exception('Login Setup Failed')
    try:
        logger.info("Granting Login DB Access")
        cursor.execute(use_pegasus_api_integration)
        cursor.execute(create_user_sql)
        cursor.execute(add_owner_sql)
        logger.info("DB Access Granted")
    except Exception:
        logger.exception('Granting DB Access to Login Failed')
    cxn.close()
    logger.info('Connection Closed')


def connect_db():
    logger.info('Running connect_db()')
    db_driver = config.db_driver
    db_server = config.db_server
    db_name = config.db_name
    db_username = config.db_setup_username
    db_password = config.db_setup_password

    import pyodbc

    logger.info('Trying to connect to {db_server}'.format(db_server=db_server))

    try:
        # TRUSTED_CONNECTION=yes;  # This is for integrated security
        conn_string = """
        DRIVER={db_driver};
        SERVER={db_server};
        UID={db_username};
        PWD={db_password};
        DATABASE=master;
        """.format(
            db_driver=db_driver,
            db_server=db_server,
            db_name=db_name,
            db_username=db_username,
            db_password=db_password
            )
        logger.info('connecting to db with ' + conn_string)
        cxn = pyodbc.connect(conn_string, autocommit=True)
        logger.info('Connected Successfully!')
        return(cxn)
    except Exception:
        logger.exception('Failed to Connect To DB')
        return(None)


def test_connect_db(username, password):
    logger.info('Running connect_db()')
    db_driver = config.db_driver
    db_server = config.db_server
    db_name = config.db_name
    db_username = username
    db_password = password

    import pyodbc

    logger.info('Trying to connect to {db_server}'.format(db_server=db_server))

    try:
        # TRUSTED_CONNECTION=yes;  # This is for integrated security
        conn_string = """
        DRIVER={db_driver};
        SERVER={db_server};
        UID={db_username};
        PWD={db_password};
        DATABASE=master;
        """.format(
            db_driver=db_driver,
            db_server=db_server,
            db_name=db_name,
            db_username=db_username,
            db_password=db_password
            )
        logger.info('connecting to db with ' + conn_string)
        cxn = pyodbc.connect(conn_string, autocommit=True)
        logger.info('Connected Successfully!')
        return(cxn)
    except Exception:
        logger.exception('Failed to Connect To DB')
        return(None)


if(__name__ == '__main__'):
    import config
    setupDB()
else:
    from app import config
