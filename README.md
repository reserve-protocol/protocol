# reserve-protocol

## Introduction

TODO

## Development Environment

### Yarn Installation

Install `yarn` (if required)

```bash
$ npm install -g yarn 
```

Clone this repository:

```bash
$ git clone git@github.com:reserve-protocol/protocol.git 
```

Install the required modules: 

 ```bash   
 # Install required modules
 $ cd ~/path/to/project
 $ yarn
```

### Running Tests

To run tests run the following command:

```bash
$ yarn test
```

## Dependencies

### zeppelin 

This codebase builds on release v4.2.0 of the openzeppelin-contracts, from commit [9fbc1d71c0ed4c68a0bc160c69df1f85e94d2d8e](https://github.com/OpenZeppelin/openzeppelin-contracts/commit/9fbc1d71c0ed4c68a0bc160c69df1f85e94d2d8e)

### uniswap

Interactions with Uniswap are specified using simple interfaces from commits [864efb5bb57bd8bde4689cfd8f7fd7ddeb100524](https://github.com/Uniswap/uniswap-v3-core/commit/864efb5bb57bd8bde4689cfd8f7fd7ddeb100524), and [764903fe5c8e274dc107163347cc2404ca0fd584](https://github.com/Uniswap/uniswap-v3-periphery/commit/764903fe5c8e274dc107163347cc2404ca0fd584). 

### Diamonds

Builds on mudgen's Diamonds 3 implementation at commit [97ef05f93c3aba8798e443d4f68ff8b915d4ca9f](https://github.com/mudgen/diamond-3-hardhat/commit/97ef05f93c3aba8798e443d4f68ff8b915d4ca9f)
