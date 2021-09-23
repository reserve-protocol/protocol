import pytest
from brownie import RTokenMock, ZERO_ADDRESS


@pytest.fixture
def rToken(circuitBreaker, tokenMock, rsr, compoundMath, owner):
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
    config = (
        0,
        0,
        100000 * 1e18,
        0,
        25000 * 1e18,
        0,
        0,
        0,
        0,
        0,
        ZERO_ADDRESS,
        circuitBreaker.address,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
    )

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
    rToken.initialize(
        "RToken", "RTKN", config, basketTokens, rsrTokenInfo, {"from": owner}
    )

    return rToken


@pytest.fixture
def rTokenIssued(rToken, tokenMock, user1, user2, owner):
    mintAmount = 5000 * 1e18
    tokenMock.mint(user1, mintAmount, {'from': owner})
    tokenMock.approve(rToken.address, mintAmount, {'from': user1})
    rToken.issue(mintAmount, {'from': user1})
    rToken.tryProcessMintings({'from': owner})
    return rToken
