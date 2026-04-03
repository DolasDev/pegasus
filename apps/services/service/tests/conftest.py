"""
Test configuration and fixtures for the Pegasus services layer.

The service modules load config and loggers at import time, so we inject
fake modules into sys.modules before any app code is imported. This prevents
the real config.py (which reads sys.argv[2] and opens a file), loggers.py
(which opens rotating file handles under Windows AppData), and models/base.py
(which creates an MSSQL engine) from executing their side-effectful module-level
code during tests.

Import order matters: sys.modules injections must happen before anything that
transitively imports app.config or app.loggers.
"""

import sys
import types
import logging
import os

# ---------------------------------------------------------------------------
# Fake config module — injected before any app.* import
# ---------------------------------------------------------------------------
_fake_config = types.ModuleType("app.config")
_fake_config.debug = True
_fake_config.production_db = False  # triggers SQLite path in base.py
_fake_config.service_name = "test-service"
_fake_config.service_type = "pegasus-events-receiver"
_fake_config.event_type = "lead"
_fake_config.api_key = "test-api-key-abc123"
_fake_config.api_base_url = "http://test-api.example.com"
_fake_config.run_frequency = 60
_fake_config.db_server = r"test-server\test-instance"
_fake_config.db_name = "TEST_DB"
_fake_config.db_username = "pegasus_services"
_fake_config.db_password = "pegasus"
_fake_config.db_driver = "{ODBC Driver 11 for SQL Server}"
_fake_config.db_setup_username = "sa"
_fake_config.db_setup_password = "password"
_fake_config.db_pegasus_db_name = "PEGASUS"
_fake_config.activate_smtp = False
_fake_config.smtp_mailhost_server = "localhost"
_fake_config.smtp_mailhost_port = 587
_fake_config.smtp_fromaddr = "from@test.com"
_fake_config.smtp_toaddrs = "to@test.com"
_fake_config.smtp_subject = "Test Alert"
_fake_config.smtp_credentials_usr = "user"
_fake_config.smtp_credentials_pwd = "pass"

sys.modules["app.config"] = _fake_config
# Some modules also do `import config` directly
sys.modules["config"] = _fake_config

# ---------------------------------------------------------------------------
# Fake loggers module — avoids file-system and APPDATA lookups
# ---------------------------------------------------------------------------
_fake_loggers = types.ModuleType("app.loggers")
_test_logger = logging.getLogger("tests.service")
_test_logger.addHandler(logging.NullHandler())
_fake_loggers.logger = _test_logger

sys.modules["app.loggers"] = _fake_loggers

# ---------------------------------------------------------------------------
# Patch base.py to use an in-memory SQLite engine
# After base is imported once its module-level engine is already created
# (using SQLite because production_db=False). We replace it with :memory:
# so tests never touch the filesystem.
# ---------------------------------------------------------------------------
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


@pytest.fixture(scope="session")
def sqlite_engine():
    """In-memory SQLite engine shared across the test session."""
    from app.models import base, Events

    engine = create_engine("sqlite:///:memory:")
    # Rebind the module-level engine and session factory
    base.engine = engine
    base.Session = sessionmaker(bind=engine)

    # Create all ORM-mapped tables
    base.Base.metadata.create_all(engine)

    yield engine

    base.Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture
def db_session(sqlite_engine):
    """Transactional test session — rolls back after each test."""
    from app.models import base

    connection = sqlite_engine.connect()
    transaction = connection.begin()

    session = sessionmaker(bind=connection)()
    base.Session = sessionmaker(bind=connection)

    yield session

    session.close()
    transaction.rollback()
    connection.close()


# ---------------------------------------------------------------------------
# Helpers available to all test modules
# ---------------------------------------------------------------------------

def make_mock_response(json_body: dict, status_code: int = 200):
    """Return a lightweight object that mimics a requests.Response."""
    import json as _json

    class _MockResponse:
        def __init__(self):
            self.status_code = status_code
            self.text = _json.dumps(json_body)
            self._json = json_body

        def json(self):
            return self._json

        def raise_for_status(self):
            if self.status_code >= 400:
                from requests.exceptions import HTTPError
                raise HTTPError(response=self)

    return _MockResponse()
