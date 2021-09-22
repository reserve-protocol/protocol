import pytest
from brownie import ZERO_ADDRESS

@pytest.fixture
def rTokenImplementation(RTokenMock, compoundMath, owner):
     rTokenImpl = owner.deploy(RTokenMock)
     return rTokenImpl

@pytest.fixture
def rTokenV2Implementation(RTokenMockV2, compoundMath, owner):
     rTokenImpl = owner.deploy(RTokenMockV2)
     return rTokenImpl

@pytest.fixture
def insurancePoolImplementation(InsurancePoolMock, owner):
    iPoolImplementation = owner.deploy(InsurancePoolMock)
    return iPoolImplementation

@pytest.fixture
def rTokenDeployer(RTokenDeployer, rTokenImplementation, insurancePoolImplementation, owner):
    return owner.deploy(RTokenDeployer, rTokenImplementation.address, insurancePoolImplementation.address);

@pytest.fixture
def deployedRTokenAddress(rTokenDeployer, rsr, user1):
    #         config = {
    #             stakingDepositDelay: 0,
    #             stakingWithdrawalDelay: 0,
    #             maxSupply: 0,
    #             minMintingSize: 0,
    #             issuanceRate: 0,
    #             rebalancingFreezeCost: 0,
    #             insurancePaymentPeriod: 0,
    #             expansionPerSecond: 0,
    #             expenditureFactor: 0,
    #             spread: 0,
    #             exchange: ZERO_ADDRESS,
    #             circuitBreaker: ZERO_ADDRESS,
    #             txFeeCalculator: ZERO_ADDRESS,
    #             insurancePool: ZERO_ADDRESS,
    #             protocolFund: ZERO_ADDRESS,
    #         }

    config = (0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS)

    #         basketTokens = [
    #             {
    #                 tokenAddress: ZERO_ADDRESS,
    #                 genesisQuantity: 0,
    #                 rateLimit: 1,
    #                 maxTrade: 1,
    #                 priceInRToken: 0,
    #                 slippageTolerance: 0,
    #             },
    #         ]
    basketTokens = [(ZERO_ADDRESS, 0, 1, 1, 0, 0)]
    
    #       rsrTokenInfo = {
    #                tokenAddress: rsr.address,
    #                genesisQuantity: 0,
    #                rateLimit: 1,
    #                maxTrade: 1,
    #                priceInRToken: 0,
    #                slippageTolerance: 0,
    #           }
    rsrTokenInfo = (rsr.address, 0, 1, 1, 0, 0)

    tx = rTokenDeployer.deploy(user1, "RToken Test", "RTKN", config, basketTokens, rsrTokenInfo)
    rTokenAddress = tx.events["RTokenDeployed"]['rToken']
    return rTokenAddress

@pytest.fixture
def upgradedRTokenAddress(deployedRTokenAddress, RToken, rTokenV2Implementation, user1):
    rTokenInstance = RToken.at(deployedRTokenAddress)
    rTokenInstance.upgradeTo(rTokenV2Implementation.address, {'from': user1})
    return deployedRTokenAddress

   
