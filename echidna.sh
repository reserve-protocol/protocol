#!/usr/bin/env bash
# Note: This script requires echidna and slither installed using solc 0.8.4
if ! command -v slither >/dev/null
then
    echo "slither could not be found"
    exit
fi

if ! command -v echidna-test >/dev/null
then
    echo "echidna could not be found"
    exit
fi

# Flatten Solidity files
rm -rf flatten
yarn flatten

# Run echidna on specific contracts
echidna-test flatten/TokenLibEchidnaTest.sol --contract TokenLibEchidnaTest --config echidna.config.yml --test-mode assertion
echidna-test flatten/TokenLibEchidnaTest.sol --contract TokenLibEchidnaTest --config echidna.config.yml
#echidna-test flatten/CompoundMathEchidnaTest.sol --contract CompoundMathEchidnaTest --config echidna.config.yml --test-mode assertion
