import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { IMPLEMENTATION } from '../../fixtures'
import { defaultFixture, ORACLE_TIMEOUT } from './fixtures'
import { getChainId } from '#/common/blockchain-utils'
import {
  IConfig,
  IGovParams,
  IRevenueShare,
  IRTokenConfig,
  IRTokenSetup,
  networkConfig,
} from '#/common/configuration'
import { CollateralStatus, MAX_UINT256, ZERO_ADDRESS } from '#/common/constants'
import { expectEvents, expectInIndirectReceipt } from '#/common/events'
import { bn, fp } from '#/common/numbers'
import { whileImpersonating } from '../../utils/impersonation'
import { advanceBlocks, advanceTime, getLatestBlockTimestamp } from '../../utils/time'
import {
  Asset,
  CTokenFiatCollateral,
  ERC20Mock,
  FacadeRead,
  FacadeTest,
  FacadeWrite,
  IAssetRegistry,
  IBasketHandler,
  RTokenAsset,
  TestIBackingManager,
  TestIDeployer,
  TestIMain,
  TestIRToken,
  IaV1,
  APoolCollateral,
  AV1Mock,
} from '#/typechain'
import { useEnv } from '#/utils/env'

const createFixtureLoader = waffle.createFixtureLoader

// Holder address in Mainnet
const holderACRV = '0x2FEdce22CE996Bff0C99a8c2f04f50D23b279cbd'

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork(`aCRVCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let aCrv: IaV1
  let aCrvCollateral: APoolCollateral
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

  const delayUntilDefault = bn('86400') // 24h

  let initialBal: BigNumber

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let chainId: number

  let aCRVCollateralFactory: ContractFactory

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
    ;({ rsr, rsrAsset, deployer, facade, facadeTest, facadeWrite, govParams } =
      await loadFixture(defaultFixture))

    // Get required contracts
    // aCRV token
    aCrv = <IaV1>await ethers.getContractAt('IaV1', networkConfig[chainId].tokens.aCRV || '')

    // Deploy cDai collateral plugin
    aCRVCollateralFactory = await ethers.getContractFactory('aPoolCollateral')
    aCrvCollateral = <CTokenFiatCollateral>(
      await aCRVCollateralFactory.deploy(
        fp('0.02'),
        networkConfig[chainId].chainlinkFeeds.CRV as string,
        aCrv.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('CRV'),
        delayUntilDefault,
        1
      )
    )

    // Setup balances for addr1 - Transfer from Mainnet holder
    initialBal = bn('2000e18')
    await whileImpersonating(holderACRV, async (acrvSigner) => {
      await aCrv.connect(acrvSigner).transfer(addr1.address, initialBal)
    })

    // Set parameters
    const rTokenConfig: IRTokenConfig = {
      name: 'RTKN RToken',
      symbol: 'RTKN',
      mandate: 'mandate',
      params: config,
    }

    // Set primary basket
    const rTokenSetup: IRTokenSetup = {
      assets: [],
      primaryBasket: [aCrvCollateral.address],
      weights: [fp('1')],
      backups: [],
      beneficiaries: [],
    }

    // Deploy RToken via FacadeWrite
    const receipt = await (
      await facadeWrite.connect(owner).deployRToken(rTokenConfig, rTokenSetup)
    ).wait()

    // Get Main
    const mainAddr = expectInIndirectReceipt(receipt, deployer.interface, 'RTokenCreated').args.main
    main = <TestIMain>await ethers.getContractAt('TestIMain', mainAddr)

    // Get core contracts
    assetRegistry = <IAssetRegistry>(
      await ethers.getContractAt('IAssetRegistry', await main.assetRegistry())
    )
    backingManager = <TestIBackingManager>(
      await ethers.getContractAt('TestIBackingManager', await main.backingManager())
    )
    basketHandler = <IBasketHandler>(
      await ethers.getContractAt('IBasketHandler', await main.basketHandler())
    )
    rToken = <TestIRToken>await ethers.getContractAt('TestIRToken', await main.rToken())
    rTokenAsset = <RTokenAsset>(
      await ethers.getContractAt('RTokenAsset', await assetRegistry.toAsset(rToken.address))
    )

    // Setup owner and unpause
    await facadeWrite.connect(owner).setupGovernance(
      rToken.address,
      false, // do not deploy governance
      true, // unpaused
      govParams, // mock values, not relevant
      owner.address, // owner
      ZERO_ADDRESS, // no guardian
      ZERO_ADDRESS // no pauser
    )
  })

  describe('Deployment', () => {
    // Check the initial state
    it('Should setup RToken, Assets, and Collateral correctly', async () => {
      // Check Collateral plugin
      expect(await aCrvCollateral.isCollateral()).to.equal(true)
      expect(await aCrvCollateral.erc20()).to.equal(aCrv.address)
      expect(await aCrv.decimals()).to.equal(18)
      expect(await aCrvCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('CRV'))
      expect(await aCrvCollateral.refPerTok()).to.be.closeTo(fp('1.09'), fp('0.01'))
      expect(await aCrvCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await aCrvCollateral.pricePerTarget()).to.equal(fp('1'))
      expect(await aCrvCollateral.strictPrice()).to.be.closeTo(fp('1.39'), fp('0.01')) // close to $0.022 cents

      // Check claim data
      await expect(aCrvCollateral.claimRewards()).to.emit(aCrvCollateral, 'RewardsClaimed')
      expect(await aCrvCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(aCrv.address)
      expect(ERC20s.length).to.eql(3)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(aCrvCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[2])).to.equal(aCrvCollateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(aCrv.address)
      expect(backing.length).to.equal(1)

      // Check other values
      expect(await basketHandler.nonce()).to.be.gt(bn(0))
      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
      const [isFallback, price] = await basketHandler.price(true)
      expect(isFallback).to.equal(false)
      expect(price).to.be.closeTo(fp('1.27'), fp('0.01'))

      // Check RToken price
      const issueAmount: BigNumber = bn('1000e18')
      await aCrv.connect(addr1).approve(rToken.address, issueAmount)
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
      expect(await rTokenAsset.strictPrice()).to.be.closeTo(fp('1.27'), fp('0.01'))
    })

    it('Should validate constructor arguments correctly', async () => {
      // no version
      await expect(
        aCRVCollateralFactory.deploy(
          fp('0.02'),
          networkConfig[chainId].chainlinkFeeds.CRV as string,
          aCrv.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('CRV'),
          delayUntilDefault,
          0
        )
      ).to.be.revertedWith('invalid version number')

      // high version
      await expect(
        aCRVCollateralFactory.deploy(
          fp('0.02'),
          networkConfig[chainId].chainlinkFeeds.CRV as string,
          aCrv.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('CRV'),
          delayUntilDefault,
          3
        )
      ).to.be.revertedWith('invalid version number')
    })
  })

  describe('Issuance/Appreciation/Redemption', () => {
    it('Should issue, redeem, and handle appreciation rates correctly', async () => {
      const issueAmount: BigNumber = bn('1000e18') // instant issuance

      // Provide approvals for issuances
      await aCrv.connect(addr1).approve(rToken.address, issueAmount)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1aCrv: BigNumber = await aCrv.balanceOf(addr1.address)

      // Check rates and prices
      const aCrvPrice1: BigNumber = await aCrvCollateral.strictPrice()
      const aCrvRefPerTok1: BigNumber = await aCrvCollateral.refPerTok()

      expect(aCrvPrice1).to.be.closeTo(fp('1.39'), fp('0.01'))
      expect(aCrvRefPerTok1).to.be.closeTo(fp('1.09'), fp('0.01'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue1).to.be.closeTo(issueAmount, fp('300')) // approx 1K in value

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(10000)
      await advanceBlocks(10000)

      // Refresh plugin manually (required)
      await rToken.claimRewards()
      //await aCrv.harvest(addr1.address, 0)
      await aCrvCollateral.refresh()
      expect(await aCrvCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, slight inrease
      const aCrvPrice2: BigNumber = await aCrvCollateral.strictPrice()
      const aCrvRefPerTok2: BigNumber = await aCrvCollateral.refPerTok()

      // Check rates and price increase
      expect(aCrvPrice2).to.be.gt(aCrvPrice1)
      expect(aCrvRefPerTok2).to.be.gt(aCrvRefPerTok1)

      // Still close to the original values
      expect(aCrvPrice2).to.be.closeTo(fp('1.39'), fp('0.01'))
      expect(aCrvRefPerTok2).to.be.closeTo(fp('1.09'), fp('0.01'))

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.gt(totalAssetValue1)

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(100000000)
      await advanceBlocks(100000000)

      // Refresh plugin manually (required)
      await rToken.claimRewards()
      //await aCrv.harvest(addr1.address, 0)
      await aCrvCollateral.refresh()
      expect(await aCrvCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed significantly
      const aCrvPrice3: BigNumber = await aCrvCollateral.strictPrice()
      const aCrvRefPerTok3: BigNumber = await aCrvCollateral.refPerTok()

      // Check rates and price increase
      expect(aCrvPrice3).to.be.gt(aCrvPrice2)
      expect(aCrvRefPerTok3).to.be.gt(aCrvRefPerTok2)

      // Need to adjust ranges
      expect(aCrvPrice3).to.be.closeTo(fp('1.39'), fp('0.01'))
      expect(aCrvRefPerTok3).to.be.closeTo(fp('1.09'), fp('0.01'))

      // Check total asset value increased
      const totalAssetValue3: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue3).to.be.gt(totalAssetValue2)

      // Redeem Rtokens with the updated rates
      await expect(rToken.connect(addr1).redeem(issueAmount)).to.emit(rToken, 'Redemption')

      // Check funds were transferred
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(0)

      // Check balances - Fewer aCrv should have been sent to the user
      const newBalanceAddr1aCrv: BigNumber = await aCrv.balanceOf(addr1.address)

      // Check received tokens represent ~1K in value at current prices
      expect(newBalanceAddr1aCrv.sub(balanceAddr1aCrv)).to.be.closeTo(fp('912'), fp('1'))

      // Check remainders in Backing Manager
      expect(await aCrv.balanceOf(backingManager.address)).to.be.closeTo(fp('1.22'), fp('0.01'))

      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        fp('1.7'),
        fp('0.05')
      )
    })
  })

  describe('Rewards', () => {
    it('Should be able to claim rewards, but none should be claimed', async () => {
      const issueAmount: BigNumber = bn('1000e18')

      await expectEvents(backingManager.claimRewards(), [
        {
          contract: backingManager,
          name: 'RewardsClaimed',
          emitted: true,
        },
      ])

      // Provide approvals for issuances
      await aCrv.connect(addr1).approve(rToken.address, issueAmount)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Advance Time
      await advanceTime(8000)

      // Claim rewards
      await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')
    })
  })

  // Note: Here the idea is to test all possible statuses and check all possible paths to default
  // hard default = SOUND -> DISABLED due to an invariant violation
  // This may require to deploy some mocks to be able to force some of these situations
  describe('Collateral Status', () => {
    it('Updates status in case of hard default', async () => {
      // Note: In this case requires to use a CToken mock to be able to change the rate
      const aCRVMockFactory: ContractFactory = await ethers.getContractFactory('aV1Mock')
      const symbol = await aCrv.symbol()
      const aCrvMock: AV1Mock = <AV1Mock>await aCRVMockFactory.deploy(symbol + ' Token', symbol)

      // Set initial exchange rate to the new cDai Mock
      await aCrvMock.mint(addr1.address, fp('100'))
      await aCrvMock.setUnderlying(fp('100'))

      // Redeploy plugin using the new aCrv mock
      const newACrvCollateral: APoolCollateral = <APoolCollateral>(
        await (
          await ethers.getContractFactory('aPoolCollateral')
        ).deploy(
          fp('0.02'),
          networkConfig[chainId].chainlinkFeeds.CRV as string,
          aCrvMock.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('CRV'),
          delayUntilDefault,
          1
        )
      )

      // init prevRefPerTok
      await newACrvCollateral.refresh()

      // Check initial state
      expect(await newACrvCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newACrvCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Decrease rate for cDAI, will disable collateral immediately
      await aCrvMock.setUnderlying(fp('99'))

      // Force updates - Should update whenDefault and status
      await expect(newACrvCollateral.refresh())
        .to.emit(newACrvCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await newACrvCollateral.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await newACrvCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    })
  })
})
