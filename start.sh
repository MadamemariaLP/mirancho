#!/bin/sh
# Arranca MiRancho en http://localhost:8787
cd "$(dirname "$0")"
[ -d .venv ] || { python3 -m venv .venv && .venv/bin/pip install -q anthropic; }
exec .venv/bin/python serve.py
