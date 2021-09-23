# reserve-protocol

## Introduction

### Setup

If you do not have `pipx` already:

```
python3 -m pip install --user pipx
python3 -m pipx ensurepath
```

To install Brownie

```
pipx install eth-brownie
```

To make sure the network configuration is correct, you may need to replace the file at `~/.brownie/network-config.yaml` with the contents from [here](https://github.com/eth-brownie/brownie/blob/master/brownie/data/network-config.yaml). Ensure they are the same.

To use the hardhat network for testing (recommended, for speed), first make sure you have `npx` available. If you don't, you can install it globally with:
```
npm install -g npx
```

After that you should be able to run `npx hardhat`. 

## Running tests

```
brownie test --network hardhat
```

