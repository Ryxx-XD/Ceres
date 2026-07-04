#!/bin/bash

# Exit on any error
set -e

# Get the absolute directory path where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SYSTEM_DIR="${SCRIPT_DIR}"

# Navigate to the system directory
cd "${SYSTEM_DIR}"

# Verify the virtual environment python interpreter exists
VENV_PYTHON="venv/bin/python"
if [ ! -f "${VENV_PYTHON}" ]; then
    echo "Error: Virtual environment python not found at ${SYSTEM_DIR}/${VENV_PYTHON}." >&2
    echo "Please configure the venv under 'venv'." >&2
    exit 1
fi

echo "============================================="
echo " Starting CERES Dashboard Server"
echo "============================================="
echo "System directory: ${SYSTEM_DIR}"
echo "Python virtual env: ${VENV_PYTHON}"
echo "============================================="

# Execute the backend app
exec "${VENV_PYTHON}" backend/app.py "$@"
