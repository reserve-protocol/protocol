import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import { getAddress } from 'ethers/lib/utils'
import hre, { ethers, waffle } from 'hardhat'
import { Collateral } from '../fixtures'
import { aaveCompDefaultFixture } from './fixtures'
import { bn, fp } from '../../common/numbers'
import { CollateralStatus, ZERO_ADDRESS } from '../../common/constants'
import {
  AAVE_ADDRESS,
  AAVE_LENDING_POOL_ADDRESS,
  COMP_ADDRESS,
  COMPTROLLER_ADDRESS,
  WETH_ADDRESS,
  DAI_ADDRESS,
  USDC_ADDRESS,
  USDT_ADDRESS,
  BUSD_ADDRESS,
  AUSDC_ADDRESS,
  AUSDT_ADDRESS,
  ADAI_ADDRESS,
  ABUSD_ADDRESS,
  CUSDC_ADDRESS,
  CUSDT_ADDRESS,
  CDAI_ADDRESS,
} from './mainnet-addresses'

import {
  AaveOracleMock,
  AavePricedFiatCollateral,
  Asset,
  ATokenFiatCollateral,
  CompoundOracleMock,
  CompoundPricedAsset,
  ComptrollerMock,
  CTokenFiatCollateral,
  CTokenMock,
  ERC20Mock,
  Facade,
  GnosisMock,
  GnosisTrade,
  IBasketHandler,
  RTokenAsset,
  StaticATokenMock,
  TestIAssetRegistry,
  TestIBackingManager,
  TestIBroker,
  TestIDeployer,
  TestIDistributor,
  TestIFurnace,
  TestIMain,
  TestIRevenueTrader,
  TestIRToken,
  TestIStRSR,
  USDCMock,
} from '../../typechain'

const createFixtureLoader = waffle.createFixtureLoader

// Relevant addresses (Mainnet)

let owner: SignerWithAddress

// Setup test environment
const setup = async () => {
  ;[owner] = await ethers.getSigners()

  // Use Mainnet fork
  await hre.network.provider.request({
    method: 'hardhat_reset',
    params: [
      {
        forking: {
          jsonRpcUrl: process.env.MAINNET_RPC_URL,
          blockNumber: 14854439,
        },
      },
    ],
  })
}

describe('AAve/Compound Tests - Mainnet Forking', function () {
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let other: SignerWithAddress

  // Deployer contract
  let deployer: TestIDeployer

  // Assets
  let collateral: Collateral[]

  // Non-backing assets
  let rsr: ERC20Mock
  let rsrAsset: Asset
  let compToken: ERC20Mock
  let compAsset: Asset
  let compoundMock: ComptrollerMock
  let aaveToken: ERC20Mock
  let aaveAsset: Asset
  let compoundOracleInternal: CompoundOracleMock
  let aaveOracleInternal: AaveOracleMock

  // Trading
  let gnosis: GnosisMock
  let broker: TestIBroker
  let rsrTrader: TestIRevenueTrader
  let rTokenTrader: TestIRevenueTrader

  // Tokens and Assets
  let initialBal: BigNumber
  let token: ERC20Mock
  let cToken: CTokenMock
  let tokenCollateral: Collateral
  let cTokenCollateral: CTokenFiatCollateral
  let erc20s: ERC20Mock[]
  let basketsNeededAmts: BigNumber[]

  // Contracts to retrieve after deploy
  let rToken: TestIRToken
  let rTokenAsset: RTokenAsset
  let stRSR: TestIStRSR
  let furnace: TestIFurnace
  let main: TestIMain
  let facade: Facade
  let assetRegistry: TestIAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: IBasketHandler
  let distributor: TestIDistributor

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet
  let basket: Collateral[]

  before(async () => {
    await setup()
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])
  })

  describe('Compound', () => {
    beforeEach(async () => {
      ;({
        rsr,
        rsrAsset,
        compToken,
        aaveToken,
        compAsset,
        aaveAsset,
        compoundMock,
        erc20s,
        collateral,
        basket,
        basketsNeededAmts,
        deployer,
        main,
        assetRegistry,
        backingManager,
        basketHandler,
        distributor,
        rToken,
        rTokenAsset,
        furnace,
        stRSR,
        gnosis,
        broker,
        facade,
        rsrTrader,
        rTokenTrader,
      } = await loadFixture(aaveCompDefaultFixture))

      // Get assets and tokens
      tokenCollateral = <AavePricedFiatCollateral>basket[0]
      cTokenCollateral = <CTokenFiatCollateral>basket[1]
      token = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await tokenCollateral.erc20())
      cToken = <CTokenMock>await ethers.getContractAt('CTokenMock', await cTokenCollateral.erc20())

      // TODO: Get Tokens from holders initial balances
    })

    it('Should setup assets correctly', async () => {
      // COMP Token
      expect(await compAsset.isCollateral()).to.equal(false)
      expect(await compAsset.erc20()).to.equal(compToken.address)
      expect(await compAsset.erc20()).to.equal(COMP_ADDRESS)
      expect(await compToken.decimals()).to.equal(18)
      expect(await compAsset.price()).to.be.closeTo(fp('58'), fp('1')) // Close to $58 USD
      expect(await compAsset.getClaimCalldata()).to.eql([ZERO_ADDRESS, '0x'])
      expect(await compAsset.rewardERC20()).to.equal(ZERO_ADDRESS)

      // AAVE Token
      expect(await aaveAsset.isCollateral()).to.equal(false)
      expect(await aaveAsset.erc20()).to.equal(aaveToken.address)
      expect(await aaveAsset.erc20()).to.equal(AAVE_ADDRESS)
      expect(await aaveToken.decimals()).to.equal(18)
      expect(await aaveAsset.price()).to.be.closeTo(fp('97'), fp('1')) // Close to $97 USD
      expect(await aaveAsset.getClaimCalldata()).to.eql([ZERO_ADDRESS, '0x'])
      expect(await aaveAsset.rewardERC20()).to.equal(ZERO_ADDRESS)
    })

    it('Should setup collaterals correctly', async () => {
      // Fiat Token Asset
      expect(await tokenCollateral.isCollateral()).to.equal(true)
      expect(await tokenCollateral.referenceERC20()).to.equal(token.address)
      expect(await tokenCollateral.erc20()).to.equal(token.address)
      expect(await tokenCollateral.erc20()).to.equal(DAI_ADDRESS)
      expect(await token.decimals()).to.equal(18)
      expect(await tokenCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await tokenCollateral.refPerTok()).to.equal(fp('1'))
      expect(await tokenCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await tokenCollateral.pricePerTarget()).to.equal(fp('1'))
      expect(await tokenCollateral.price()).to.be.closeTo(fp('1'), fp('0.01'))

      expect(await tokenCollateral.getClaimCalldata()).to.eql([ZERO_ADDRESS, '0x'])
      expect(await tokenCollateral.rewardERC20()).to.equal(ZERO_ADDRESS)

      // CToken
      expect(await cTokenCollateral.isCollateral()).to.equal(true)
      expect(await cTokenCollateral.referenceERC20()).to.equal(token.address)
      expect(await cTokenCollateral.erc20()).to.equal(cToken.address)
      expect(await cTokenCollateral.erc20()).to.equal(CDAI_ADDRESS)
      expect(await cToken.decimals()).to.equal(8)
      expect(await cTokenCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await cTokenCollateral.refPerTok()).to.be.closeTo(fp('0.022'), fp('0.001'))
      expect(await cTokenCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await cTokenCollateral.pricePerTarget()).to.equal(fp('1'))
      expect(await cTokenCollateral.prevReferencePrice()).to.equal(
        await cTokenCollateral.refPerTok()
      )
      expect(await cTokenCollateral.price()).to.be.closeTo(fp('0.022'), fp('0.001')) // close to $0.022 cents

      let calldata = compoundMock.interface.encodeFunctionData('claimComp', [owner.address])
      expect(await cTokenCollateral.connect(owner).getClaimCalldata()).to.eql([
        compoundMock.address,
        calldata,
      ])
      expect(await cTokenCollateral.rewardERC20()).to.equal(compToken.address)
    })

    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(aaveToken.address)
      expect(ERC20s[3]).to.equal(compToken.address)

      const initialTokens: string[] = await Promise.all(
        basket.map(async (c): Promise<string> => {
          return await c.erc20()
        })
      )
      expect(ERC20s.slice(4)).to.eql(initialTokens)
      expect(ERC20s.length).to.eql((await facade.basketTokens()).length + 4)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(aaveAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[3])).to.equal(compAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[4])).to.equal(tokenCollateral.address)
      expect(await assetRegistry.toAsset(ERC20s[5])).to.equal(cTokenCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[4])).to.equal(tokenCollateral.address)
      expect(await assetRegistry.toColl(ERC20s[5])).to.equal(cTokenCollateral.address)
    })

    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCapitalized()).to.equal(true)
      const backing = await facade.basketTokens()
      expect(backing[0]).to.equal(token.address)
      expect(backing[1]).to.equal(cToken.address)

      expect(backing.length).to.equal(2)

      // Check other values
      expect((await basketHandler.lastSet())[0]).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.price()).to.be.closeTo(fp('1'), fp('0.01'))
      expect(await facade.callStatic.totalAssetValue()).to.equal(0)

      // Check RToken price
       expect(await rToken.price()).to.be.closeTo(fp('1'), fp('0.01'))
    })
  })
})