from sqlalchemy import Column, Integer, String, ForeignKey, select
from sqlalchemy_utils import create_view
from sqlalchemy.sql import literal_column
from app.models.base import Base

# Define SQLAlchemy classes for each table/view

create_service_order_view = select(
    literal_column("''").label('event_fk'),
    literal_column("''").label('vendor_status'),
    literal_column("''").label('vendor_contact_id'),
    literal_column("''").label('source_system_text_key'),
    literal_column("''").label('source_system'))
create_move_management_view = select(
    literal_column("''").label('event_fk'),
    literal_column("''").label('service_order'),
    literal_column("''").label('reference_number'),
    literal_column("''").label('departure_address_line_1'),
    literal_column("''").label('departure_address_line_2'),
    literal_column("''").label('departure_address_line_3'),
    literal_column("''").label('departure_country_code'),
    literal_column("''").label('departure_state_province_code'),
    literal_column("''").label('departure_city'),
    literal_column("''").label('departure_postal_code'),
    literal_column("''").label('destination_address_line_1'),
    literal_column("''").label('destination_address_line_2'),
    literal_column("''").label('destination_address_line_3'),
    literal_column("''").label('destination_country_code'),
    literal_column("''").label('destination_state_province_code'),
    literal_column("''").label('destination_city'),
    literal_column("''").label('destination_postal_code'),
    literal_column("''").label('hhg_authorized'),
    literal_column("''").label('vehicles_authorized'),
    literal_column("''").label('pets_authorized'),
    literal_column("''").label('primary_shipment'),
    literal_column("''").label('source_system_text_key'),
    literal_column("''").label('source_system'))
create_service_order_partner_vendor_view = select(
    literal_column("''").label('event_fk'),
    literal_column("''").label('vendor_id'),
    literal_column("''").label('role'))
create_move_management_household_good_view = select(
    literal_column("''").label('event_fk'),
    literal_column("''").label('shipment_type'),
    literal_column("''").label('container_size_description'),
    literal_column("''").label('container_size_measurement'),
    literal_column("''").label('additional_information'),
    literal_column("''").label('cost_estimate'),
    literal_column("''").label('cost_estimate_currency'),
    literal_column("''").label('actual_cost'),
    literal_column("''").label('actual_cost_currency'),
    literal_column("''").label('weight_estimate'),
    literal_column("''").label('weight_estimate_unit'),
    literal_column("''").label('actual_weight'),
    literal_column("''").label('actual_weight_unit'),
    literal_column("''").label('distance_estimate'),
    literal_column("''").label('distance_estimate_unit'),
    literal_column("''").label('actual_distance'),
    literal_column("''").label('actual_distance_unit'),
    literal_column("''").label('requested_survey_date'),
    literal_column("''").label('scheduled_survey_date'),
    literal_column("''").label('actual_survey_date'),
    literal_column("''").label('requested_pack_date'),
    literal_column("''").label('scheduled_pack_start_date'),
    literal_column("''").label('scheduled_pack_end_date'),
    literal_column("''").label('actual_pack_start_date'),
    literal_column("''").label('actual_pack_end_date'),
    literal_column("''").label('requested_load_date'),
    literal_column("''").label('scheduled_load_date'),
    literal_column("''").label('scheduled_load_end_date'),
    literal_column("''").label('actual_load_date'),
    literal_column("''").label('actual_load_end_date'),
    literal_column("''").label('requested_delivery_date'),
    literal_column("''").label('scheduled_delivery_date'),
    literal_column("''").label('scheduled_delivery_end_date'),
    literal_column("''").label('actual_delivery_date'),
    literal_column("''").label('actual_delivery_end_date'),
    literal_column("''").label('scheduled_customs_clearance_date'),
    literal_column("''").label('actual_customs_clearance_date'),
    literal_column("''").label('estimated_storage'),
    literal_column("''").label('begin_date'),
    literal_column("''").label('end_date'),
    literal_column("''").label('storage_location'),
    literal_column("''").label('storage_cost_estimate'),
    literal_column("''").label('storage_cost_estimate_currency'),
    literal_column("''").label('actual_storage_cost'),
    literal_column("''").label('actual_storage_cost_currency'),
    literal_column("''").label('assignee_contacted_date'),
    literal_column("''").label('assignee_briefing_date'),
    literal_column("''").label('scheduled_storage_begin_date'),
    literal_column("''").label('scheduled_storage_end_date'),
    literal_column("''").label('employee_special_instructions'),
    literal_column("''").label('scheduled_departure_from_origin_port_date'),
    literal_column("''").label('scheduled_arrival_at_destination_port_date'),
    literal_column("''").label('actual_departure_from_origin_port_date'),
    literal_column("''").label('actual_arrival_at_destination_port_date'))
create_document_move_management_view = select(
    literal_column("''").label('event_fk'),
    literal_column("''").label('attached_record_id'),
    literal_column("''").label('document_id'))
create_document_view = select(
    literal_column("''").label('event_fk'),
    literal_column("''").label('content_length'),
    literal_column("''").label('content_type'),
    literal_column("''").label('document'),
    literal_column("''").label('document_type_id'),
    literal_column("''").label('file_name'),
    literal_column("''").label('description'),
    literal_column("''").label('name'),
    literal_column("''").label('page_id'))
create_vendor_contact_view = select(
    literal_column("''").label('event_fk'),
    literal_column("''").label('vendor_contact'),
    literal_column("''").label('inactive'),
    literal_column("''").label('preferred'),
    literal_column("''").label('type'),
    literal_column("''").label('state_province_code'),
    literal_column("''").label('city'),
    literal_column("''").label('designations'),
    literal_column("''").label('mobile_phone'),
    literal_column("''").label('office_phone'),
    literal_column("''").label('first_name'),
    literal_column("''").label('last_name'),
    literal_column("''").label('country_code'),
    literal_column("''").label('email'),
    literal_column("''").label('job_title'))
create_service_order_partner_vendor_view = select(
    literal_column("''").label('event_fk'),
    literal_column("''").label('vendor_id'),
    literal_column("''").label('role'))
create_move_management_insurance_view = select(
    literal_column("''").label('event_fk'),
    literal_column("''").label('coverage_amount'),
    literal_column("''").label('coverage_currency'),
    literal_column("''").label('additional_coverage_charged_to'),
    literal_column("''").label('coverage_description'))
create_move_management_insurance_claim_view = select(
    literal_column("''").label('event_fk'),
    literal_column("''").label('claim_amount'),
    literal_column("''").label('claim_currency'),
    literal_column("''").label('claim_date'),
    literal_column("''").label('damage_summary'),
    literal_column("''").label('settlement_amount'),
    literal_column("''").label('settlement_currency'),
    literal_column("''").label('settlement_date'),
    literal_column("''").label('source_system_text_key'),
    literal_column("''").label('source_system'))
create_move_management_vehicle_view = select(
    literal_column("''").label('event_fk'),
    literal_column("''").label('vehicle_type'),
    literal_column("''").label('make'),
    literal_column("''").label('model'),
    literal_column("''").label('year'),
    literal_column("''").label('scheduled_load_date'),
    literal_column("''").label('actual_load_date'),
    literal_column("''").label('scheduled_delivery_date'),
    literal_column("''").label('actual_delivery_date'),
    literal_column("''").label('scheduled_customs_clearance_date'),
    literal_column("''").label('actual_customs_clearance_date'),
    literal_column("''").label('estimated_storage'),
    literal_column("''").label('storage_location'),
    literal_column("''").label('begin_date'),
    literal_column("''").label('end_date'),
    literal_column("''").label('days_in_storage'),
    literal_column("''").label('cost_estimate'),
    literal_column("''").label('cost_estimate_currency'),
    literal_column("''").label('actual_cost'),
    literal_column("''").label('actual_cost_currency'),
    literal_column("''").label('source_system_text_key'),
    literal_column("''").label('source_system'))
create_assignment_pet_view = select(
    literal_column("''").label('event_fk'),
    literal_column("''").label('assignment_id'),
    literal_column("''").label('type'),
    literal_column("''").label('subtype'),
    literal_column("''").label('weight'),
    literal_column("''").label('weight_unit'),
    literal_column("''").label('quantity'))
create_move_management_shipping_view = select(
    literal_column("''").label('event_fk'),
    literal_column("''").label('move_management_id'),
    literal_column("''").label('actual_cost'),
    literal_column("''").label('actual_cost_currency'),
    literal_column("''").label('actual_delivery_date'),
    literal_column("''").label('actual_pickup_date'),
    literal_column("''").label('boarding_end_date'),
    literal_column("''").label('boarding_start_date'),
    literal_column("''").label('cost_estimate'),
    literal_column("''").label('cost_estimate_currency'),
    literal_column("''").label('quarantine_end_date'),
    literal_column("''").label('quarantine_required'),
    literal_column("''").label('quarantine_start_date'),
    literal_column("''").label('scheduled_delivery_date'),
    literal_column("''").label('scheduled_pickup_date'),
    literal_column("''").label('source_system_text_key'),
    literal_column("''").label('source_system'))
create_move_management_shipping_assignment_pet_view = select(
    literal_column("''").label('event_fk'),
    literal_column("''").label('move_management_shipping_id'),
    literal_column("''").label('assignment_pet_id'))

v_equus_service_order = create_view('v_equus_service_order',create_service_order_view, Base.metadata)
v_equus_move_management = create_view('v_equus_move_management',create_move_management_view,Base.metadata)
v_equus_service_order_partner_vendor = create_view('v_equus_service_order_partner_vendor',create_service_order_partner_vendor_view,Base.metadata)
v_equus_move_management_household_good = create_view('v_equus_move_management_household_good',create_move_management_household_good_view,Base.metadata)
v_equus_document_move_management = create_view('v_equus_document_move_management',create_document_move_management_view,Base.metadata)
v_equus_document = create_view('v_equus_document',create_document_view,Base.metadata)
v_equus_vendor_contact = create_view('v_equus_vendor_contact',create_vendor_contact_view,Base.metadata)
v_equus_move_management_insurance = create_view('v_equus_move_management_insurance',create_move_management_insurance_view,Base.metadata)
v_equus_move_management_insurance_claim = create_view('v_equus_move_management_insurance_claim',create_move_management_insurance_claim_view,Base.metadata)
v_equus_move_management_vehicle = create_view('v_equus_move_management_vehicle',create_move_management_vehicle_view,Base.metadata)
v_equus_assignment_pet = create_view('v_equus_assignment_pet',create_assignment_pet_view,Base.metadata)
v_equus_move_management_shipping = create_view('v_equus_move_management_shipping',create_move_management_shipping_view,Base.metadata)
v_equus_move_management_shipping_assignment_pet = create_view('v_equus_move_management_shipping_assignment_pet',create_move_management_shipping_assignment_pet_view,Base.metadata)


class VServiceOrder(Base):
    __table__ = v_equus_service_order

class VMoveManagement(Base):
    __table__ =v_equus_move_management

class VServiceOrderPartnerVendor(Base):
    __table__ =v_equus_service_order_partner_vendor

class VMoveManagementHouseholdGood(Base):
    __table__ =v_equus_move_management_household_good
    
class VDocumentMoveManagement(Base):
    __table__ =v_equus_document_move_management

class VDocument(Base):
    __table__ =v_equus_document

class VVendorContact(Base):
    __table__ =v_equus_vendor_contact
    
class VMoveManagementInsurance(Base):
    __table__ =v_equus_move_management_insurance

class VMoveManagementInsuranceClaim(Base):
    __table__ =v_equus_move_management_insurance_claim

class VMoveManagementVehicle(Base):
    __table__ =v_equus_move_management_vehicle

class VAssignmentPet(Base):
    __table__ =v_equus_assignment_pet

class VMoveManagementShipping(Base):
    __table__ =v_equus_move_management_shipping

class VMoveManagementShippingAssignmentPet(Base):
    __table__ =v_equus_move_management_shipping_assignment_pet