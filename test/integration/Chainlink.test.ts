import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { Collateral, IConfig, IMPLEMENTATION } from '../fixtures'
import { defaultFixture } from './fixtures'
import { ZERO_ADDRESS } from '../../common/constants'
import { fp } from '../../common/numbers'

import { STAKEDAAVE_ADDRESS, COMP_ADDRESS, AAVE_ADDRESS, RSR_ADDRESS, RSR_USD_PRICE_FEED, AAVE_USD_PRICE_FEED, COMP_USD_PRICE_FEED, } from './mainnet'

import { ChainlinkPricedAsset, ERC20Mock, IERC20 } from '../../typechain'

const createFixtureLoader = waffle.createFixtureLoader

const describeFork = process.env.FORK ? describe : describe.skip

describeFork(`Chainlink - Integration - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens and Assets
  let rsrMainnet: ERC20Mock
  let rsrCLAsset: ChainlinkPricedAsset
  let compToken: ERC20Mock
  let aaveToken: ERC20Mock
  let compCLAsset: ChainlinkPricedAsset
  let aaveCLAsset: ChainlinkPricedAsset
  
  // Contracts to retrieve after deploy
  let config: IConfig

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  describe('Assets/Collateral Setup', () => {
    before(async () => {
      ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
      loadFixture = createFixtureLoader([wallet])
    })

    beforeEach(async () => {
      ;[owner] = await ethers.getSigners()
      ;({ compToken, aaveToken, config } = await loadFixture(defaultFixture))

      // Create RSR Asset
      const ChainlinkAssetFactory = await ethers.getContractFactory('ChainlinkPricedAsset')

      rsrMainnet = <ERC20Mock>await ethers.getContractAt('ERC20Mock', RSR_ADDRESS)
      rsrCLAsset = <ChainlinkPricedAsset>(
        await ChainlinkAssetFactory.deploy(
          rsrMainnet.address,
          config.maxTradeVolume,
          RSR_USD_PRICE_FEED
        )
      )

      
      compCLAsset = <ChainlinkPricedAsset>(
        await ChainlinkAssetFactory.deploy(
          compToken.address,
          config.maxTradeVolume,
          COMP_USD_PRICE_FEED
        )
      )

      aaveCLAsset = <ChainlinkPricedAsset>(
        await ChainlinkAssetFactory.deploy(
          aaveToken.address,
          config.maxTradeVolume,
          AAVE_USD_PRICE_FEED
        )
      )


    })

    it('Should setup assets correctly', async () => {
      // RSR Asset
      expect(await rsrCLAsset.isCollateral()).to.equal(false)
      expect(await rsrCLAsset.erc20()).to.equal(rsrMainnet.address)
      expect(await rsrCLAsset.erc20()).to.equal(RSR_ADDRESS)
      expect(await rsrMainnet.decimals()).to.equal(18)
      expect(await rsrCLAsset.maxTradeVolume()).to.equal(config.maxTradeVolume)
      expect(await rsrCLAsset.price()).to.be.closeTo(fp('0.0069'), fp('0.0001')) // approx $0.00699 on June 2022
      expect(await rsrCLAsset.getClaimCalldata()).to.eql([ZERO_ADDRESS, '0x'])
      expect(await rsrCLAsset.rewardERC20()).to.equal(ZERO_ADDRESS)

      // COMP Token
      expect(await compCLAsset.isCollateral()).to.equal(false)
      expect(await compCLAsset.erc20()).to.equal(compToken.address)
      expect(await compCLAsset.erc20()).to.equal(COMP_ADDRESS)
      expect(await compToken.decimals()).to.equal(18)
      expect(await compCLAsset.price()).to.be.closeTo(fp('58'), fp('0.5')) // Close to $58 USD - June 2022
      expect(await compCLAsset.getClaimCalldata()).to.eql([ZERO_ADDRESS, '0x'])
      expect(await compCLAsset.rewardERC20()).to.equal(ZERO_ADDRESS)

      // AAVE Token
      expect(await aaveCLAsset.isCollateral()).to.equal(false)
      expect(await aaveCLAsset.erc20()).to.equal(aaveToken.address)
      expect(await aaveCLAsset.erc20()).to.equal(STAKEDAAVE_ADDRESS)
      expect(await aaveToken.decimals()).to.equal(18)
      expect(await aaveCLAsset.price()).to.be.closeTo(fp('105'), fp('0.5')) // Close to $105 USD - June 2022 - Uses AAVE price
      expect(await aaveCLAsset.getClaimCalldata()).to.eql([ZERO_ADDRESS, '0x'])
      expect(await aaveCLAsset.rewardERC20()).to.equal(ZERO_ADDRESS)
    })
  })
})
