import { expect } from 'chai'
import { ethers } from 'hardhat'
import { BigNumber, ContractFactory, Contract } from 'ethers'
import { bn } from '../../common/numbers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ERC20Mock } from '../../typechain/ERC20Mock'
import { ATokenMock } from '../../typechain/ATokenMock'
import { CTokenMock } from '../../typechain/CTokenMock'
import { CollateralP0 } from '../../typechain/CollateralP0'
import { ATokenCollateralP0 } from '../../typechain/ATokenCollateralP0'
import { CTokenCollateralP0 } from '../../typechain/CTokenCollateralP0'

import { ZERO_ADDRESS } from '../../common/constants'

describe('CollateralP0 contracts', () => {
  let owner: SignerWithAddress

  let FiatCollateralFactory: ContractFactory
  let ACollateralFactory: ContractFactory
  let CCollateralFactory: ContractFactory
  let ERC20: ContractFactory
  let AToken: ContractFactory
  let CToken: ContractFactory
  let collFiatToken: CollateralP0
  let collAToken: ATokenCollateralP0
  let collCToken: CTokenCollateralP0
  let fiatUSDC: ERC20Mock
  let aUSDT: ATokenMock
  let cDAI: CTokenMock

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    // Deploy underlying tokens
    ERC20 = await ethers.getContractFactory('ERC20Mock')
    AToken = await ethers.getContractFactory('ATokenMock')
    CToken = await ethers.getContractFactory('CTokenMock')

    fiatUSDC = <ERC20Mock>await ERC20.deploy('Fiat USDC', 'USDC')
    aUSDT = <ATokenMock>await AToken.deploy('AToken USDT', 'aUSDT', fiatUSDC.address)
    cDAI = <CTokenMock>await CToken.deploy('CToken DAI', 'cDAI', fiatUSDC.address)

    // Deploy Collaterals
    FiatCollateralFactory = await ethers.getContractFactory('CollateralP0')
    collFiatToken = <CollateralP0>await FiatCollateralFactory.deploy(fiatUSDC.address, 6)

    ACollateralFactory = await ethers.getContractFactory('ATokenCollateralP0')
    collAToken = <ATokenCollateralP0>await ACollateralFactory.deploy(aUSDT.address, 18)

    CCollateralFactory = await ethers.getContractFactory('CTokenCollateralP0')
    collCToken = <CTokenCollateralP0>await CCollateralFactory.deploy(cDAI.address, 18)
  })

  describe('Deployment', () => {
    it('Deployment should setup collaterals correctly', async () => {
      // Fiat Token
      expect(await collFiatToken.redemptionRate()).to.equal(bn(1e18))
      expect(await collFiatToken.erc20()).to.equal(fiatUSDC.address)
      expect(await collFiatToken.decimals()).to.equal(6)
      expect(await collFiatToken.fiatcoin()).to.equal(fiatUSDC.address)
      expect(await collFiatToken.isFiatcoin()).to.equal(true)

      // AToken
      expect(await collAToken.redemptionRate()).to.equal(bn(1e18))
      expect(await collAToken.erc20()).to.equal(aUSDT.address)
      expect(await collAToken.decimals()).to.equal(18)
      expect(await collAToken.fiatcoin()).to.equal(fiatUSDC.address)
      expect(await collAToken.isFiatcoin()).to.equal(false)

      // CToken
      expect(await collCToken.redemptionRate()).to.equal(bn(1e18))
      expect(await collCToken.erc20()).to.equal(cDAI.address)
      expect(await collCToken.decimals()).to.equal(18)
      expect(await collCToken.fiatcoin()).to.equal(fiatUSDC.address)
      expect(await collCToken.isFiatcoin()).to.equal(false)
    })
  })
})
