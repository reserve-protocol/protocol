def test_RTokenDeployer_initialized(rTokenDeployer, rTokenImplementation, insurancePoolImplementation):
    # check implementations
    assert rTokenDeployer.rTokenImplementation() == rTokenImplementation.address
    assert rTokenDeployer.insurancePoolImplementation() == insurancePoolImplementation.address

   


