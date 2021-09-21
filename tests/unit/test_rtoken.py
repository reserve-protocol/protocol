import pytest
from brownie import ZERO_ADDRESS

@pytest.fixture
def rToken(RTokenMock, circuitBreaker, tokenMock, rsr, compoundMath, owner):
    # config =  ({
    #         "stakingDepositDelay": 0,
    #         "stakingWithdrawalDelay": 0,
    #         "maxSupply": 0,
    #         "minMintingSize": 0,
    #         "issuanceRate": 100,
    #         "rebalancingFreezeCost": 0,
    #         "insurancePaymentPeriod": 0,
    #         "expansionPerSecond": 0,
    #         "expenditureFactor": 0,
    #         "spread": 0,
    #         "exchange": ZERO_ADDRESS,
    #         "circuitBreaker": circuitBreaker.address,
    #         "txFeeCalculator": ZERO_ADDRESS,
    #         "insurancePool": ZERO_ADDRESS,
    #         "protocolFund": ZERO_ADDRESS
    #     })
    
    config = (0, 0, 0, 0, 100, 0, 0, 0, 0, 0, ZERO_ADDRESS, circuitBreaker.address, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS)
    # basketTokens = [
    #         {
    #             "tokenAddress": tokenMock.address,
    #             "genesisQuantity": 1e18,
    #             "rateLimit": 1,
    #             "maxTrade": 1,
    #             "priceInRToken": 0,
    #             "slippageTolerance": 0,
    #         },
    #     ]
    
    basketTokens = [(tokenMock.address, 1e18, 1, 1, 0, 0)]
    
    # rsrTokenInfo = {
    #         "tokenAddress": rsr.address,
    #         "genesisQuantity": 0,
    #         "rateLimit": 1,
    #         "maxTrade": 1,
    #         "priceInRToken": 0,
    #         "slippageTolerance": 0,
    #     }

    rsrTokenInfo = (rsr.address, 0, 1, 1, 0, 0)

    rToken = owner.deploy(RTokenMock)
    rToken.initialize("RToken", "RTKN", config, basketTokens, rsrTokenInfo, {'from': owner})

    #rToken2 = web3.eth.contract(rToken.address, abi=rToken.abi)
    #rToken2.functions.initialize("RToken", "RTKN", config, basketTokens, rsrTokenInfo).transact()
    return rToken
    

def test_initialized(rToken, circuitBreaker):
    assert rToken.issuanceRate() == 100
    assert rToken.stakingDepositDelay() == 0
    assert rToken.circuitBreaker() == circuitBreaker.address
