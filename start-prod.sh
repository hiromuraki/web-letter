#!/bin/bash

uv run uvicorn src.main:app --host 0.0.0.0 --port 8025 --workers 1
