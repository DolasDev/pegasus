import xmltodict
from app.loggers import logger


def parseEventDataXml(xml_string: str) -> dict:
    """
    Convert a serialized XML event_data string to the dict shape expected by
    ControlFlow.insertIntoDB():

        {'data': [{'name': '<TABLE_NAME>', 'values': {<field>: <value>, ...}}, ...]}

    Expected XML structure:
        <EventData>
          <Table name="LEAD">
            <ID>1</ID>
            <FIRST_NAME>Jane</FIRST_NAME>
          </Table>
          <Table name="ADDRESS">
            ...
          </Table>
        </EventData>
    """
    logger.info('Running parseEventDataXml()')
    parsed = xmltodict.parse(xml_string)

    root_key = list(parsed.keys())[0]
    tables_raw = parsed[root_key].get('Table', [])

    # xmltodict wraps a single child element as a dict, not a list
    if isinstance(tables_raw, dict):
        tables_raw = [tables_raw]

    data = []
    for table in tables_raw:
        table_name = table.pop('@name', table.pop('name', 'UNKNOWN'))
        values = {k: (v if v is not None else '') for k, v in table.items()}
        data.append({'name': table_name, 'values': values})

    return {'data': data}
