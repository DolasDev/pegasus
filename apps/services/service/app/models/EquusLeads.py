from sqlalchemy import Column, Integer, String, ForeignKey
from app.models.base import Base

class ServiceOrder(Base):
    __tablename__ = 'equus_service_order'

    ID = Column(Integer, primary_key=True)
    SERVICE_ORDER_ID = Column(String)
    ASSIGNMENT_ID = Column(String)
    COORDINATOR_RESOURCE_ID = Column(String)
    PURCHASE_ORDER_NUMBER = Column(String)
    PEGASUS_EVENT_ID = Column(String)
    PEGASUS_API_ID = Column(String)

class Resource(Base):
    __tablename__ = 'equus_resource'

    ID = Column(Integer, primary_key=True)
    RESOURCE_ID = Column(String)
    ASSIGNMENT_ID = Column(String)
    FIRST_NAME = Column(String)
    LAST_NAME = Column(String)
    EMAIL = Column(String)
    CONTACT_PHONE = Column(String)
    PEGASUS_EVENT_ID = Column(String)
    PEGASUS_API_ID = Column(String)


class Employee(Base):
    __tablename__ = 'equus_employee'

    ID = Column(Integer, primary_key=True)
    EMPLOYEE_ID = Column(String)    
    ASSIGNMENT_ID = Column(String) 
    COMPANY_ID = Column(String)
    FIRST_NAME = Column(String)
    LAST_NAME = Column(String)
    USER_ID_EMAIL = Column(String)
    PEGASUS_EVENT_ID = Column(String)
    PEGASUS_API_ID = Column(String)

    

class AssignmentEmployeeContact(Base):
    __tablename__ = 'equus_assignment_employee_contact'

    ID = Column(Integer, primary_key=True)
    ASSIGNMENT_EMPLOYEE_CONTACT_ID = Column(String)
    ASSIGNMENT_ID = Column(String)
    CONTACT_TYPE = Column(String)
    LOCATION_TYPE = Column(String)
    NUMBER_ADDRESS = Column(String)
    PEGASUS_EVENT_ID = Column(String)
    PEGASUS_API_ID = Column(String)
    

class Assignment(Base):
    __tablename__ = 'equus_assignment'
    
    ID = Column(Integer, primary_key=True)
    ASSIGNMENT_ID = Column(String)
    COORDINATOR_RESOURCE_ID = Column(String)
    EFFECTIVE_DATE = Column(String)
    STATUS = Column(String)
    PEGASUS_EVENT_ID = Column(String)
    PEGASUS_API_ID = Column(String)


class MoveManagementServiceRequest(Base):
    __tablename__ = 'equus_move_management_service_request'

    ID = Column(Integer, primary_key=True)
    MOVE_MANAGEMENT_SERVICE_REQUEST_ID = Column(String)
    ASSIGNMENT_ID = Column(String)
    ACTUAL_LUMP_SUM_AMOUNT = Column(String)
    ACTUAL_LUMP_SUM_CURRENCY= Column(String)
    AUTHORIZED_WEIGHT = Column(String)
    AUTHORIZED_WEIGHT_UNIT = Column(String)
    CONTAINER_SIZE_DESCRIPTION = Column(String)
    CONTAINER_SIZE_MEASUREMENT = Column(String)
    DEPARTURE_ASSIGNMENT_MAILING_ADDRESS_ID = Column(String)
    DESTINATION_ASSIGNMENT_MAILING_ADDRESS_ID = Column(String)
    HHG_AUTHORIZED = Column(String)
    PETS_AUTHORIZED = Column(String)
    SHIPMENT_TYPE = Column(String)
    SPECIAL_INSTRUCTIONS = Column(String)
    SPECIAL_SERVICES_AUTHORIZED = Column(String)
    VEHICLES_AUTHORIZED = Column(String)
    PEGASUS_EVENT_ID = Column(String)
    PEGASUS_API_ID = Column(String)

      

class AssignmentMailingAddress(Base):
    __tablename__ = 'equus_assignment_mailing_address'

    ID = Column(Integer, primary_key=True)
    ASSIGNMENT_MAILING_ADDRESS_ID = Column(String)
    ASSIGNMENT_ID = Column(String)
    CITY = Column(String)
    COUNTRY = Column(String)
    LINE_1 = Column(String)
    LOCATION_TYPE = Column(String)
    STATE_PROVINCE_DB_VALUE = Column(String)
    STATE_PROVINCE_DISPLAY = Column(String)
    PEGASUS_EVENT_ID = Column(String)
    PEGASUS_API_ID = Column(String)

