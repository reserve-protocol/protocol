
# Rocket Pool - RETH Collateral Plugin


## Introduction

This folder contains the smart contract for implementation of Rocket Pool's RETH collateral plugin for the Reserve Protocol.
For this submission, the choice for a demurrage collateral was based on the fact that RETH is self referential, but it's exchange rate to ETH does not have only upwards market fluctuations.


## Demurrage Collateral 

Even though rETH to ETH exchange rate is supposed to be never decreasing, it's not always a truthy condition.


![Graph](https://docs.rocketpool.net/assets/img/reth_rate.15a0870a.png)




![Graph](https://gateway.pinata.cloud/ipfs/Qmd1oqu5KiTQ8GDw8dqxornwUC5HZ4uWohTtZ7J3dHm6Rb)


A demurrage collateral is a good solution for tokens in which the exchange rate generally increase, but it is acceptable to have it falling at some times. 
In order to preserve pool's status, refPerTok is increased as time passes.

In order to save gas costs on demurrage's refPerTok() function, 
A lazy compounding logic was used to quantify inflation.
When called within the refresh() function, the latest refPerTok() value and the latest entire hour timestamp since 01/01/2020 00:00:00 GMT+0000 are stored. 
This enables is the least possible amount of exponentiations.

### refPerTok
```
        
        uint nowMinusLastTimestamp = block.timestamp - lastProcessedTimestamp;
        uint subtractFactor = nowMinusLastTimestamp % (3600 * 24); 
        uint daysUncounted = (nowMinusLastTimestamp - subtractFactor) / (3600 * 24) ; // subtraction to get a timestamp that represents a whole hour
     
        /// @dev requires contract to be refreshed at least every maxDaysWORefresh -1 days.
        /// This value is defined at the constructor.
        /// This protects from the risk of arithmetic overflow through doing exponential operations.
        if(daysUncounted < maxDaysWORefresh){
            uint latestRefPerTok_ = latestRefPerTok;
            while(daysUncounted > 0){
      
                latestRefPerTok_ = latestRefPerTok_ * (FIX_ONE + 1e6 *(demurrage_rate_per_second * 3600 * 24)) /  FIX_ONE;
                daysUncounted -= 1;
            }
        return uint192(latestRefPerTok_);
        } else{
            // defaults the collateral

            return(latestRefPerTok - 1);
        }

        
```

It follows this formula:
```
(1 + demurrage_rate_per_second) ^ t
```

The first gas optimization strategy was to account a demurrage rate on a per day basis, as this reduces the amount of multiplication iterations for exponential calculations.
Both demurrage_rate_per_second and now - lastProcessedTimestamp are converted to their daily equivalents.

```
        // equivalent to (1 + demurrage_rate_per_second)
        (FIX_ONE + 1e6 *(demurrage_rate_per_second * 3600 * 24))/ FIX_ONE
        
        uint nowMinusLastTimestamp = block.timestamp - lastProcessedTimestamp;
        uint subtractFactor = nowMinusLastTimestamp % (3600 * 24); 
        uint daysUncounted = (nowMinusLastTimestamp - subtractFactor) / (3600 * 24) ; // subtraction to get a timestamp that represents a whole hour
```

The next step is iterate this multiplication logic n times based on the amount of days uncounted. 
It was opted to limit this amount of iterations to save gas and to avoid risking numerical imprecision.
The final result looks like this:
```
      uint latestRefPerTok_ = latestRefPerTok;
            while(daysUncounted > 0){

                latestRefPerTok_ = latestRefPerTok_ * (FIX_ONE + 1e6 *(demurrage_rate_per_second * 3600 * 24)) /  FIX_ONE;
                daysUncounted -= 1;
            }
        return uint192(latestRefPerTok_);
```


### Refresh()

This function updates statuses and checks for DEFAULT and IFFY conditionals.


#### Default

Defaults when the pool is not updated frequently enough.



#### Iffy

Iffy when the Oracle Feed errors.




### strictPrice

Ttrict price {UoA/tok} based on RocketPool's contract calls, Chainlink Feed calls and refPerTok().



### Constructor

When deploying this smart contract, refPerTok() gets called and the initial status is setup. 

1640995200 is Reserve Protocol's arbitrary timestamp for demurrage collateral plugins.



### Helper functions


#### rEthToEth

This function returns a quantity of whole (1 unit = 1e18) ETH units. It purpose it to find Rocket Pool's ETH exchange rate to ETH and it is called by strictPrice(). 



## Tests

All tests can be run with following command:
```
yarn hardhat test test/integration/rocket-pool/*test.ts
```
The tests were use the default block number: 14916729.

## Potential Vulnerabilities

REthDemurrageCollateral.constructor(uint192,AggregatorV3Interface,IERC20Metadata,uint192,uint48,bytes32,uint256,int8,uint128,uint24) (contracts/plugins/rocket-pool/REthDemurrageCollateral.sol#33-65) uses a weak PRNG: "subtractor = nowMinusArbTimestamp % (3600 * 24) (contracts/plugins/rocket-pool/REthDemurrageCollateral.sol#61)" 
REthDemurrageCollateral.refPerTok() (contracts/plugins/rocket-pool/REthDemurrageCollateral.sol#120-144) uses a weak PRNG: "subtractFactor = nowMinusLastTimestamp % (3600 * 24) (contracts/plugins/rocket-pool/REthDemurrageCollateral.sol#123)" 

Reference: https://github.com/crytic/slither/wiki/Detector-Documentation#weak-PRNG

### Discussion
Slither's recommendation to this issue is not to use block.timestamp as a source of randomness.
As this plugin utilizes the current timestamp to check whether a certain amount of
time has passed since the last update, this should not be directly concerning.
Miners can modify the timestamp by up to 900 seconds. In refPerTok increase rates that doesn't represent a high impact issue, as it's value gets updated every 86400 seconds. 
According to Consensys' smart contract best practices: 
"If the scale of your time-dependent event can vary by 15 seconds and maintain integrity, it is safe to use a block.timestamp."

## Contact

#### Discord: JoVi#6132
#### LinkedIn: [João Freire](https://www.linkedin.com/in/joaovwfreire/)
#### E-mail: jvwfreire@gmail.com

## References
[Math in Solidity Part 4: Compound Interest](https://medium.com/coinmonks/math-in-solidity-part-4-compound-interest-512d9e13041b)

[Math in Solidity Part 5: Exponent and Logarithm](https://medium.com/coinmonks/math-in-solidity-part-5-exponent-and-logarithm-9aef8515136e)

[Block Timestamp Manipulation](https://www.bookstack.cn/read/ethereumbook-en/spilt.14.c2a6b48ca6e1e33c.md)

[What do I need to be careful about when using block.timestamp?](https://ethereum.stackexchange.com/questions/108033/what-do-i-need-to-be-careful-about-when-using-block-timestamp)

[Miners can influence the value of block.timestamp to perform Maximal Extractable Value (MEV) attacks. #110](https://github.com/code-423n4/2022-06-putty-findings/issues/110)

[Timestamp Dependence](https://consensys.github.io/smart-contract-best-practices/development-recommendations/solidity-specific/timestamp-dependence/#the-15-second-rule)