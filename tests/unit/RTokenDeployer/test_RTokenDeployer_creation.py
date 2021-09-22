
def test_RTokenDeployer_created(deployedRTokenAddress, rTokenDeployer, rsr, user1, other, RToken, InsurancePool, rTokenImplementation, insurancePoolImplementation):
    # check Rtoken instance
    rTokenInstance = RToken.at(deployedRTokenAddress)
    assert rTokenInstance.name() == "RToken Test"
    assert rTokenInstance.symbol() == "RTKN"
    assert rTokenInstance.totalSupply() == 0
    assert deployedRTokenAddress != rTokenImplementation.address
    assert rTokenInstance.owner() == user1

    # check Insurance Pool
    iPoolAddress = rTokenInstance.insurancePool()
    iPoolInstance = InsurancePool.at(iPoolAddress)
    assert iPoolAddress != insurancePoolImplementation.address
    assert iPoolInstance.rToken() == deployedRTokenAddress
    assert iPoolInstance.rsr() == rsr.address
    
    # should track tokens created by factory
    assert rTokenDeployer.isRToken(deployedRTokenAddress) == True
    assert rTokenDeployer.isRToken(other) == False

