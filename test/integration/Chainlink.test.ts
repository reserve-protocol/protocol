import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { IConfig, IMPLEMENTATION } from '../fixtures'
import { defaultFixture } from './fixtures'
import { ZERO_ADDRESS } from '../../common/constants'
import { bn, fp } from '../../common/numbers'

import {
  DAI_ADDRESS,
  USDC_ADDRESS,
  USDT_ADDRESS,
  BUSD_ADDRESS,
  COMP_ADDRESS,
  STAKEDAAVE_ADDRESS,
  RSR_ADDRESS,
  RSR_USD_PRICE_FEED,
  AAVE_USD_PRICE_FEED,
  COMP_USD_PRICE_FEED,
  DAI_USD_PRICE_FEED,
  USDC_USD_PRICE_FEED,
  USDT_USD_PRICE_FEED,
  BUSD_USD_PRICE_FEED,
} from './mainnet'

import {
  ChainlinkPricedAsset,
  ChainlinkPricedFiatCollateral,
  ERC20Mock,
  IERC20,
  USDCMock,
} from '../../typechain'

const createFixtureLoader = waffle.createFixtureLoader

const describeFork = process.env.FORK ? describe : describe.skip

describeFork(`Chainlink - Integration - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress

  // Tokens and Assets
  let rsrMainnet: ERC20Mock
  let compToken: ERC20Mock
  let aaveToken: ERC20Mock
  let dai: ERC20Mock
  let usdc: USDCMock
  let usdt: ERC20Mock
  let busd: ERC20Mock
  let rsrCLAsset: ChainlinkPricedAsset
  let compCLAsset: ChainlinkPricedAsset
  let aaveCLAsset: ChainlinkPricedAsset
  let daiCLCollateral: ChainlinkPricedFiatCollateral
  let usdcCLCollateral: ChainlinkPricedFiatCollateral
  let usdtCLCollateral: ChainlinkPricedFiatCollateral
  let busdCLCollateral: ChainlinkPricedFiatCollateral
  let erc20s: IERC20[]

  // Contracts to retrieve after deploy
  let config: IConfig

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  describe('Assets/Collateral Setup', () => {
    const DEFAULT_THRESHOLD = fp('0.05') // 5%
    const DELAY_UNTIL_DEFAULT = bn('86400') // 24h

    before(async () => {
      ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
      loadFixture = createFixtureLoader([wallet])
    })

    beforeEach(async () => {
      ;[owner] = await ethers.getSigners()
      ;({ compToken, aaveToken, erc20s, config } = await loadFixture(defaultFixture))

      // Get tokens
      dai = <ERC20Mock>erc20s[0] // DAI
      usdc = <ERC20Mock>erc20s[1] // USDC
      usdt = <ERC20Mock>erc20s[2] // USDT
      busd = <ERC20Mock>erc20s[3] // BUSD

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

      // Create Collaterals
      const ChainlinkCollFactory = await ethers.getContractFactory('ChainlinkPricedFiatCollateral')

      daiCLCollateral = <ChainlinkPricedFiatCollateral>(
        await ChainlinkCollFactory.deploy(
          dai.address,
          config.maxTradeVolume,
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT,
          DAI_USD_PRICE_FEED
        )
      )
      usdcCLCollateral = <ChainlinkPricedFiatCollateral>(
        await ChainlinkCollFactory.deploy(
          usdc.address,
          config.maxTradeVolume,
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT,
          USDC_USD_PRICE_FEED
        )
      )

      usdtCLCollateral = <ChainlinkPricedFiatCollateral>(
        await ChainlinkCollFactory.deploy(
          usdt.address,
          config.maxTradeVolume,
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT,
          USDT_USD_PRICE_FEED
        )
      )

      busdCLCollateral = <ChainlinkPricedFiatCollateral>(
        await ChainlinkCollFactory.deploy(
          busd.address,
          config.maxTradeVolume,
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT,
          BUSD_USD_PRICE_FEED
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

    it('Should setup collaterals correctly - Fiatcoins', async () => {
      // Define interface required for each fiat coin
      interface TokenInfo {
        token: ERC20Mock
        tokenDecimals: number
        tokenAddress: string
        tokenCollateral: ChainlinkPricedFiatCollateral
      }

      // DAI - USDC - USDT - BUSD
      const tokenInfos: TokenInfo[] = [
        {
          token: dai,
          tokenDecimals: 18,
          tokenAddress: DAI_ADDRESS,
          tokenCollateral: daiCLCollateral,
        },
        {
          token: usdc,
          tokenDecimals: 6,
          tokenAddress: USDC_ADDRESS,
          tokenCollateral: usdcCLCollateral,
        },
        {
          token: usdt,
          tokenDecimals: 6,
          tokenAddress: USDT_ADDRESS,
          tokenCollateral: usdtCLCollateral,
        },
        {
          token: busd,
          tokenDecimals: 18,
          tokenAddress: BUSD_ADDRESS,
          tokenCollateral: busdCLCollateral,
        },
      ]

      for (const tkInf of tokenInfos) {
        // Fiat Token Assets
        expect(await tkInf.tokenCollateral.isCollateral()).to.equal(true)
        expect(await tkInf.tokenCollateral.referenceERC20()).to.equal(tkInf.token.address)
        expect(await tkInf.tokenCollateral.erc20()).to.equal(tkInf.token.address)
        expect(await tkInf.tokenCollateral.erc20()).to.equal(tkInf.tokenAddress)
        expect(await tkInf.token.decimals()).to.equal(tkInf.tokenDecimals)
        expect(await tkInf.tokenCollateral.targetName()).to.equal(
          ethers.utils.formatBytes32String('USD')
        )
        expect(await tkInf.tokenCollateral.refPerTok()).to.equal(fp('1'))
        expect(await tkInf.tokenCollateral.targetPerRef()).to.equal(fp('1'))
        expect(await tkInf.tokenCollateral.pricePerTarget()).to.equal(fp('1'))
        expect(await tkInf.tokenCollateral.price()).to.be.closeTo(fp('1'), fp('0.05')) // Should always be close to $1

        expect(await tkInf.tokenCollateral.getClaimCalldata()).to.eql([ZERO_ADDRESS, '0x'])
        expect(await tkInf.tokenCollateral.rewardERC20()).to.equal(ZERO_ADDRESS)
      }
    })
  })
})
