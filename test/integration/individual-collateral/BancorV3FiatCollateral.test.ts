import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { IMPLEMENTATION } from '../../fixtures'
import { defaultFixture, ORACLE_TIMEOUT } from './fixtures'
import { getChainId } from '../../../common/blockchain-utils'
import {
  IConfig,
  IGovParams,
  IRevenueShare,
  IRTokenConfig,
  IRTokenSetup,
  networkConfig,
} from '../../../common/configuration'
import { CollateralStatus, MAX_UINT256, ZERO_ADDRESS } from '../../../common/constants'
import { expectEvents, expectInIndirectReceipt } from '../../../common/events'
import { bn, fp, toBNDecimals } from '../../../common/numbers'
import { whileImpersonating } from '../../utils/impersonation'
import { setOraclePrice } from '../../utils/oracles'
import { advanceBlocks, advanceTime, getLatestBlockTimestamp } from '../../utils/time'
import {
  Asset,
  ComptrollerMock,
  CTokenMock,
  ERC20Mock,
  FacadeRead,
  FacadeTest,
  FacadeWrite,
  IAssetRegistry,
  IBasketHandler,
  InvalidMockV3Aggregator,
  OracleLib,
  MockV3Aggregator,
  RTokenAsset,
  TestIBackingManager,
  TestIDeployer,
  TestIMain,
  TestIRToken,
  BancorV3FiatCollateral,
  IBnTokenERC20,
  IBnTokenERC20__factory,
  IStandardRewards
} from '../../../typechain'
import { equal } from 'assert'

const createFixtureLoader = waffle.createFixtureLoader

// Holder address in Mainnet
const HOLDER_USDC = '0xf977814e90da44bfa03b6295a0616a897441acec'

const describeFork = process.env.FORK ? describe : describe.skip

describeFork(`BancorV3FiatCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let usdc: ERC20Mock
  let BancorV3Collateral: BancorV3FiatCollateral
  let bnToken: IBnTokenERC20
  let rewardsProxy: IStandardRewards
  let cDai: CTokenMock
  let compToken: ERC20Mock
  let compAsset: Asset
  let comptroller: ComptrollerMock
  let rsr: ERC20Mock
  let rsrAsset: Asset

  // Core Contracts
  let main: TestIMain
  let rToken: TestIRToken
  let rTokenAsset: RTokenAsset
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: IBasketHandler

  let deployer: TestIDeployer
  let facade: FacadeRead
  let facadeTest: FacadeTest
  let facadeWrite: FacadeWrite
  let oracleLib: OracleLib
  let govParams: IGovParams

  // RToken Configuration
  const dist: IRevenueShare = {
    rTokenDist: bn(40), // 2/5 RToken
    rsrDist: bn(60), // 3/5 RSR
  }
  const config: IConfig = {
    dist: dist,
    minTradeVolume: fp('1e4'), // $10k
    rTokenMaxTradeVolume: fp('1e6'), // $1M
    shortFreeze: bn('259200'), // 3 days
    longFreeze: bn('2592000'), // 30 days
    rewardPeriod: bn('604800'), // 1 week
    rewardRatio: fp('0.02284'), // approx. half life of 30 pay periods
    unstakingDelay: bn('1209600'), // 2 weeks
    tradingDelay: bn('0'), // (the delay _after_ default has been confirmed)
    auctionLength: bn('900'), // 15 minutes
    backingBuffer: fp('0.0001'), // 0.01%
    maxTradeSlippage: fp('0.01'), // 1%
    issuanceRate: fp('0.00025'), // 0.025% per block or ~0.1% per minute
    scalingRedemptionRate: fp('0.05'), // 5%
    redemptionRateFloor: fp('1e6'), // 1M RToken
  }

  const defaultThreshold = fp('0.05') // 5%
  const delayUntilDefault = bn('86400') // 24h

  let initialBal: BigNumber

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let chainId: number

  let BancorV3CollateralFactory: ContractFactory
  let MockV3AggregatorFactory: ContractFactory
  let mockChainlinkFeed: MockV3Aggregator

  before(async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])

    chainId = await getChainId(hre)
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }
  })

  beforeEach(async () => {
    ;[owner, addr1] = await ethers.getSigners()
    ;({ rsr, rsrAsset, deployer, facade, facadeTest, facadeWrite, oracleLib, govParams } =
      await loadFixture(defaultFixture))

    // usdc token
    usdc= <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.USDC || '')
    )

    bnToken= <IBnTokenERC20>(
      await ethers.getContractAt('IBnTokenERC20', networkConfig[chainId].BANCOR_PROXY || '')
    )

    rewardsProxy = <IStandardRewards>(
      await ethers.getContractAt('IStandardRewards', networkConfig[chainId].BANCOR_REWARDS_PROXY || '')
    )

    // Deploy BancorV3 collateral plugin
    BancorV3CollateralFactory = await ethers.getContractFactory('BancorV3FiatCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })
    BancorV3Collateral = <BancorV3FiatCollateral>(
      await BancorV3CollateralFactory.deploy(
        fp('0.02'),
        networkConfig[chainId].chainlinkFeeds.USDC as string,
        usdc.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
        (await usdc.decimals()).toString(),
        bnToken.address,
        rewardsProxy.address,
      )
    )

    initialBal = bn('2000000e18')
    await whileImpersonating(HOLDER_USDC, async (UsdcSigner) => {
      await usdc.connect(UsdcSigner).transfer(addr1.address, toBNDecimals(initialBal, 8))
    })

  })

  describe('Deployment', () => {
    it('Should setup RToken, Assets, and Collateral correctly', async () => {
      expect(await bnToken.address).to.equal(networkConfig[chainId].BANCOR_PROXY)
      expect(await BancorV3Collateral.isCollateral()).to.equal(true)
      expect(await BancorV3Collateral.erc20Decimals()).to.equal(await usdc.decimals())
      expect(await BancorV3Collateral.erc20()).to.equal(usdc.address)
      expect(await BancorV3Collateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await BancorV3Collateral.targetPerRef()).to.equal(fp('1'))
      expect(await BancorV3Collateral.pricePerTarget()).to.equal(fp('1'))
      expect(await BancorV3Collateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
      expect(await BancorV3Collateral.refPerTok()).to.equal(fp('1.003759')) // close to $1
      expect(await BancorV3Collateral.strictPrice()).to.be.closeTo(fp('2.2'), fp('0.1')) // close to $0.022 cents

    })
  })

})
