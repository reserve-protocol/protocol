#!/bin/bash -euxo pipefail
# Run the subset of our unit tests tagged with '#fast'

# cd to project root
while [ ! -d .git -a `pwd` != "/" ]; do cd ..; done

export JOBS=3 # Fastest by actual test on 2022-04-28, though 2 and 4 are pretty close
export ONLY_FAST=yes

# Run these two test types in parallel
yarn compile
PROTO_IMPL=0 yarn exec hardhat test --no-compile $(find test -name '*.test.ts') & PID0=$!
PROTO_IMPL=1 yarn exec hardhat test --no-compile test/*.test.ts & PID1=$!

# Wait for both tests, and exit with error code if either failed
wait $PID0 || exit $?
wait $PID1 || exit $?
