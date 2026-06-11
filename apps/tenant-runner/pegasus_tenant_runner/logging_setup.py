"""JSON-structured logging for the tenant runner.

Line-for-line mirror of the formatter in
``apps/temporal-worker/pegasus_temporal_worker/worker.py`` (Phase 2 Unit 5)
so CloudWatch Logs Insights queries written for the stdlib worker work
unchanged against runner logs. Duplicated rather than shared on purpose:
the two apps are separate Python distributions with opposite trust models,
and a shared "common" package would couple the trusted stdlib image to the
runner image for ~80 lines of formatter.
"""

from __future__ import annotations

import json
import logging
import sys
from typing import Any


class JsonFormatter(logging.Formatter):
    """JSON-line formatter for CloudWatch Logs Insights compatibility.

    Always includes ``timestamp``, ``level``, ``logger``, ``message``.
    Extra fields passed via ``logging.Logger.<level>(..., extra={...})``
    are merged in at the top level.
    """

    _STD_ATTRS = frozenset(
        {
            "name",
            "msg",
            "args",
            "levelname",
            "levelno",
            "pathname",
            "filename",
            "module",
            "exc_info",
            "exc_text",
            "stack_info",
            "lineno",
            "funcName",
            "created",
            "msecs",
            "relativeCreated",
            "thread",
            "threadName",
            "processName",
            "process",
            "message",
            "taskName",
        }
    )

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        for key, value in record.__dict__.items():
            if key in self._STD_ATTRS or key.startswith("_"):
                continue
            try:
                json.dumps(value)
            except (TypeError, ValueError):
                value = repr(value)
            payload[key] = value
        return json.dumps(payload, separators=(",", ":"))


def configure_logging() -> None:
    """Install the JSON formatter on the root logger (idempotent)."""
    root = logging.getLogger()
    for handler in list(root.handlers):
        root.removeHandler(handler)
    handler = logging.StreamHandler(stream=sys.stdout)
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)
    root.setLevel(logging.INFO)
