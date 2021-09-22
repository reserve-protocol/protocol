def test_rtoken_initialized(rToken, circuitBreaker, tokenMock, owner):
    # check config
    assert rToken.issuanceRate() == 25000 * 1e18
    assert rToken.stakingDepositDelay() == 0
    assert rToken.circuitBreaker() == circuitBreaker.address

    # check token balances
    ownerBalance = rToken.balanceOf(owner)
    assert rToken.totalSupply() == ownerBalance
    assert rToken.totalSupply() == 0
    assert rToken.basketSize() == 1
    
    # check basket properly set
    (bskTokenAddress, bskGenesisQty, bskRateLimit, _, _, _) = rToken.basketToken(0)
    assert bskTokenAddress == tokenMock.address
    assert bskGenesisQty == 1e18
    assert bskRateLimit == 1



