#!/usr/bin/env bash
# Note: This script requires mythril installed via Docker
SOLC="0.8.4"

if ! command -v docker >/dev/null
then
    echo "docker could not be found"
    exit
fi

if ! docker image inspect mythril/myth:latest >/dev/null 2>&1
then
    echo "mythril could not be found"
    exit
fi

# Flatten Solidity files
rm -rf flatten
yarn flatten

# Run mythril on specific contracts
docker run -v $(pwd):/tmp mythril/myth analyze /tmp/flatten/Basket.sol --solv $SOLC
docker run -v $(pwd):/tmp mythril/myth analyze /tmp/flatten/Token.sol --solv $SOLC
docker run -v $(pwd):/tmp mythril/myth analyze /tmp/flatten/RSR.sol --solv $SOLC
docker run -v $(pwd):/tmp mythril/myth analyze /tmp/flatten/CircuitBreaker.sol --solv $SOLC
