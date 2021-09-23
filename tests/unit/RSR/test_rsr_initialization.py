def test_rsr_initialized(rsr, previousRSR, slowWallet, multisigWallet):
    # check supply and initial values
    totalSupplyRSR = rsr.totalSupply()     
    assert totalSupplyRSR == previousRSR.totalSupply()
    assert totalSupplyRSR == rsr.fixedSupply()
    assert rsr.slowWallet() == slowWallet
    assert rsr.multisigWallet() == multisigWallet

