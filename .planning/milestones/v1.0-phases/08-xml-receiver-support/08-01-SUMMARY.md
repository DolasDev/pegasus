---
phase: 08-xml-receiver-support
plan: 01
subsystem: services
tags: [xml, receiver, controller, python, events]

# Dependency graph
requires: []
provides:
  - XML input format option in the Pegasus Events Receiver controller
  - xml_handler.py — parseEventDataXml() converts serialized XML event_data to standard dict shape
affects: [apps/services/controller, apps/services/service]

# Tech tracking
tech-stack:
  added: [xmltodict==0.14.2]
  patterns:
    [
      normaliseEventData() called per-event before EventsBroker — converts XML string to dict in-place,
      leaving all downstream handlers unchanged,
    ]

key-files:
  created:
    - apps/services/service/app/xml_handler.py
  modified:
    - apps/services/controller/src/gui-config.js
    - apps/services/service/app/config.py
    - apps/services/service/app/ControlFlow.py
    - apps/services/service/requirements.txt

key-decisions:
  - 'Conversion happens at normaliseEventData() before EventsBroker.processEvent() — insertIntoDB() and all downstream handlers are unchanged'
  - 'config.input_format defaults to "json" via .get() so existing config files without the key continue working'
  - 'API path (getEventsLists, APICalls, response_handlers) is entirely unchanged — only event_data extraction is format-aware'

patterns-established:
  - 'normaliseEventData(event) pattern: mutate event dict in-place before passing to broker, keeping broker and DB layer format-agnostic'

requirements-completed: []

# Metrics
completed: 2026-04-02
---

# Phase 08 Plan 01: XML Receiver Support Summary

**Added XML input format support to the Pegasus Events Receiver. The outer API envelope remains JSON; only the event_data field is parsed differently when XML format is selected.**

## Files Created/Modified

- `apps/services/controller/src/gui-config.js` — added `Input Format` select (JSON/XML, default JSON) after the `Service Type` field
- `apps/services/service/app/config.py` — added `input_format = data.get('input_format', 'json')` with safe default
- `apps/services/service/app/xml_handler.py` — new module; `parseEventDataXml(xml_string)` parses serialized XML into `{'data': [{'name': '<TABLE>', 'values': {...}}, ...]}`
- `apps/services/service/app/ControlFlow.py` — added `xml_handler` import, `normaliseEventData()` helper, and call site in `runEventsReceiver()` before `EventsBroker.processEvent()`
- `apps/services/service/requirements.txt` — added `xmltodict==0.14.2`

## Decisions Made

- Conversion is isolated to `normaliseEventData()` — called once per event after `createEvent()` and before `EventsBroker.processEvent()`. Everything downstream reads the same dict shape regardless of input format.
- `xmltodict` used for XML→dict conversion: no stdlib ElementTree boilerplate, handles single-element wrapping (`dict` vs `list`) automatically.
- `config.input_format` defaults to `'json'` so no existing config files need migration.

## Deviations from Plan

None — implemented exactly as written.
