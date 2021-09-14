#!/usr/bin/env bash
# Note: This script requires slither installed using solc 0.8.4
if ! command -v slither >/dev/null
then
    echo "slither could not be found"
    exit
fi

# Flatten Solidity files
rm -rf flatten
yarn flatten

# Run slither on specific contracts
slither flatten/Token.sol --print human-summary
slither flatten/RelayERC20.sol --print human-summary
