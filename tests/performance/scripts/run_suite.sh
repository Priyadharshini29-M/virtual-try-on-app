#!/usr/bin/env bash
# Full local suite (replica only). ~45 min. Usage: bash scripts/run_suite.sh
cd "$(dirname "$0")/.."
set -x
python scripts/run_test.py baseline  --max-vus 50  --mock-workers 10
python scripts/run_test.py load      --max-vus 150 --mock-workers 10 --dur-scale 0.6
python scripts/run_test.py spike     --max-vus 200 --mock-workers 10 --yes-i-am-authorised
python scripts/run_test.py spike     --max-vus 200 --mock-workers 1  --yes-i-am-authorised --dur-scale 0.7   # GPU-bound: real endpoint = 1 worker
python scripts/run_test.py stress    --max-vus 300 --mock-workers 10 --dur-scale 0.5 --yes-i-am-authorised
python scripts/run_test.py recovery  --max-vus 50  --mock-workers 10
python scripts/run_test.py soak      --max-vus 50  --mock-workers 10 --soak-min 10 --yes-i-am-authorised
echo SUITE-DONE
