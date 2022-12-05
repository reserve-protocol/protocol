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
import { bn, fp } from '../../../common/numbers'
import { whileImpersonating } from '../../utils/impersonation'
import { advanceTime, getLatestBlockTimestamp } from '../../utils/time'
import {
  Asset,
  ERC20Mock,
  FacadeRead,
  FacadeTest,
  FacadeWrite,
  IAssetRegistry,
  IBasketHandler,
  IReth,
  IRocketNetworkBalances,
  IRocketStorage,
  InvalidMockV3Aggregator,
  OracleLib,
  RethCollateral,
  RTokenAsset,
  TestIBackingManager,
  TestIDeployer,
  TestIMain,
  TestIRToken,
} from '../../../typechain'

const createFixtureLoader = waffle.createFixtureLoader

// Holder address in Mainnet
const holderRETH = '0xba12222222228d8ba445958a75a0704d566bf2c8'

const describeFork = process.env.FORK ? describe : describe.skip

describeFork(`RethCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let reth: IReth
  let rocketBalances: IRocketNetworkBalances
  let rethCollateral: RethCollateral
  let rocketStorage: IRocketStorage
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
  const delayUntilDefault = bn('86400') // 24h
  // values at block 14916729
  const initialRethRate = fp('1.026892161919818755')
  const initialEthPrice = fp('1859.17')
  const rocketBalanceKey = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('network.balance.total'))

  let initialBal: BigNumber

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let chainId: number

  let rethCollateralFactory: ContractFactory

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

    // Get required contracts for rocket pool
    // RocketNetworkBalances
    rocketBalances = <IRocketNetworkBalances>(
      await ethers.getContractAt(
        'IRocketNetworkBalances',
        networkConfig[chainId].ROCKET_NETWORK_BALANCES || ''
      )
    )
    // RocketStorage
    rocketStorage = <IRocketStorage>(
      await ethers.getContractAt('IRocketStorage', networkConfig[chainId].ROCKET_STORAGE || '')
    )
    // Get reth contract
    reth = <IReth>await ethers.getContractAt('IReth', networkConfig[chainId].tokens.RETH || '')

    // Deploy RETH collateral plugin
    rethCollateralFactory = await ethers.getContractFactory('RethCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })
    rethCollateral = <RethCollateral>(
      await rethCollateralFactory.deploy(
        fp('1'),
        networkConfig[chainId].chainlinkFeeds.ETH as string,
        reth.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('ETH'),
        delayUntilDefault
      )
    )

    // Setup balances for addr1 - Transfer from Mainnet holder
    // reth
    initialBal = fp('5000')
    await whileImpersonating(holderRETH, async (rethSigner) => {
      await reth.connect(rethSigner).transfer(addr1.address, initialBal)
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
      primaryBasket: [rethCollateral.address],
      weights: [fp('1')],
      backups: [],
      beneficiary: ZERO_ADDRESS,
      revShare: { rTokenDist: bn('0'), rsrDist: bn('0') },
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
      // reth (RethCollateral)
      expect(await rethCollateral.isCollateral()).to.equal(true)
      expect(await rethCollateral.erc20()).to.equal(reth.address)
      expect(await rethCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('ETH'))
      expect(await rethCollateral.refPerTok()).to.be.closeTo(initialRethRate, bn('10'))
      expect(await rethCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await rethCollateral.pricePerTarget()).to.be.closeTo(initialEthPrice, fp('1'))
      expect(await rethCollateral.prevReferencePrice()).to.equal(await rethCollateral.refPerTok())
      expect(await rethCollateral.strictPrice()).to.be.closeTo(
        initialEthPrice.mul(initialRethRate).div(bn('1e18')),
        fp('1')
      )
      expect(await rethCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(reth.address)
      expect(ERC20s.length).to.eql(3)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(rethCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[2])).to.equal(rethCollateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(reth.address)
      expect(backing.length).to.equal(1)

      // Check other values
      expect(await basketHandler.nonce()).to.be.gt(bn(0))
      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
      const [isFallback, price] = await basketHandler.price(true)
      expect(isFallback).to.equal(false)
      expect(price).to.be.closeTo(initialEthPrice, fp('0.01'))

      // Check RToken price
      const issueAmount: BigNumber = initialBal.div(initialEthPrice)
      await reth.connect(addr1).approve(rToken.address, issueAmount.mul(100))
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
      expect(await rTokenAsset.strictPrice()).to.be.closeTo(initialEthPrice, fp('0.01'))
    })
  })

  describe('Issuance/Appreciation/Redemption', () => {
    // Issuance and redemption, making the collateral appreciate over time
    it('Should issue, redeem, and handle appreciation rates correctly', async () => {
      const issueAmount: BigNumber = fp('1000')

      // Provide approvals for issuances
      await reth.connect(addr1).approve(rToken.address, issueAmount.mul(100))

      const preBalanceAddr1reth: BigNumber = await reth.balanceOf(addr1.address)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1reth: BigNumber = await reth.balanceOf(addr1.address)

      // Check rates and prices
      const rethPrice1: BigNumber = await rethCollateral.strictPrice() // 1909.1671006764695 cents
      const rethRefPerTok1: BigNumber = await rethCollateral.refPerTok() // 1.0268921619198188

      expect(rethPrice1).to.be.closeTo(
        initialEthPrice.mul(initialRethRate).div(bn('1e18')),
        fp('1')
      )
      expect(rethRefPerTok1).to.be.closeTo(initialRethRate, fp('0.0001'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue1).to.be.closeTo(
        issueAmount.mul(initialEthPrice).div(bn('1e18')),
        fp('0.00000000001')
      )

      const rocketEtherBal: BigNumber = await rocketBalances.getTotalETHBalance()
      const higherBal: BigNumber = rocketEtherBal.add(fp('1000'))

      // Rocket pool updates its exchange rate after the ODAO multisig updates RocketStorage's
      // values for ether and reth. By impersonating RocketBalances we can directly update the
      // storage values to manipulate the exchange rate while using real rocket pool contracts
      // instead of resorting to mocks
      await whileImpersonating(rocketBalances.address, async (rethSigner) => {
        await rocketStorage.connect(rethSigner).setUint(rocketBalanceKey, higherBal)
      })

      await rethCollateral.refresh()
      expect(await rethCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, slight increase
      const rethPrice2: BigNumber = await rethCollateral.strictPrice() // 1929.9180985125483
      const rethRefPerTok2: BigNumber = await rethCollateral.refPerTok() // 1.0380535930079273

      // Check rates and price increase
      expect(rethPrice2).to.be.gt(rethPrice1)
      expect(rethRefPerTok2).to.be.gt(rethRefPerTok1)

      // Still close to the original values
      expect(rethPrice2).to.be.closeTo(rethPrice1, fp('21'))
      expect(rethRefPerTok2).to.be.closeTo(rethRefPerTok1, fp('0.02'))

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.gt(totalAssetValue1)

      // increase reth to eth exchange rate significantly by setting systems
      // record of its eth balance much higher
      const highestBal: BigNumber = rocketEtherBal.add(fp('10000'))
      await whileImpersonating(rocketBalances.address, async (rethSigner) => {
        await rocketStorage.connect(rethSigner).setUint(rocketBalanceKey, highestBal)
      })

      await rethCollateral.refresh()
      expect(await rethCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed significantly
      const rethPrice3: BigNumber = await rethCollateral.strictPrice() // 2116.6770790372593
      const rethRefPerTok3: BigNumber = await rethCollateral.refPerTok() // 1.1385064728009056

      // Check rates and price increase
      expect(rethPrice3).to.be.gt(rethPrice2)
      expect(rethRefPerTok3).to.be.gt(rethRefPerTok2)

      // Need to adjust ranges
      expect(rethPrice3).to.be.closeTo(fp('2116.677'), fp('0.001'))
      expect(rethRefPerTok3).to.be.closeTo(fp('1.138'), fp('0.001'))

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

      // Check balances - less reth should have been sent to the user
      const newBalanceAddr1reth: BigNumber = await reth.balanceOf(addr1.address)

      // Check received tokens represent same value deposited
      const input = preBalanceAddr1reth.sub(balanceAddr1reth)
      const valueIncrease = rethRefPerTok3.mul(bn('1e18')).div(rethRefPerTok1)
      const fairOut = input.mul(bn('1e18')).div(valueIncrease)
      expect(newBalanceAddr1reth.sub(balanceAddr1reth)).to.be.closeTo(fairOut, bn('8e7'))

      // Check remainders in Backing Manager
      expect(await reth.balanceOf(backingManager.address)).to.be.closeTo(
        input.sub(fairOut),
        bn('5e7')
      )

      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        input.sub(fairOut).mul(rethRefPerTok3).mul(initialEthPrice).div(bn('1e36')), // ~= 4962.8 usd (from above)
        fp('0.5')
      )
    })
  })

  // Note: Even if the collateral does not provide reward tokens, this test should be performed to check that
  // claiming calls throughout the protocol are handled correctly and do not revert.
  describe('Rewards', () => {
    it('Should be able to claim rewards (if applicable)', async () => {
      const issueAmount: BigNumber = fp('1000')

      await expectEvents(backingManager.claimRewards(), [
        {
          contract: backingManager,
          name: 'RewardsClaimed',
          args: ['0x' + '00'.repeat(20), 0],
          emitted: true,
        },
      ])

      // Provide approvals for issuances
      await reth.connect(addr1).approve(rToken.address, issueAmount.mul(100))

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Advance Time
      await advanceTime(8000)

      // Claim rewards
      await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

      // Keep moving time
      await advanceTime(3600)

      // Get additional rewards
      await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')
    })
  })

  describe('Price Handling', () => {
    it('Should handle invalid/stale Price', async () => {
      // Reverts with stale price
      await advanceTime(ORACLE_TIMEOUT.toString())

      await expect(rethCollateral.strictPrice()).to.be.revertedWith('StalePrice()')

      // Fallback price is returned
      const [isFallback, price] = await rethCollateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(fp('1'))

      // Refresh should mark status IFFY
      await rethCollateral.refresh()
      expect(await rethCollateral.status()).to.equal(CollateralStatus.IFFY)

      // Remaining iffy long enough should tranasition state to disabled
      await advanceTime(delayUntilDefault.add(bn('1')).toString())
      await rethCollateral.refresh()
      expect(await rethCollateral.status()).to.equal(CollateralStatus.DISABLED)
    })
  })

  // Note: Here the idea is to test all possible statuses and check all possible paths to default
  // there is no soft default for reth collateral, it's fine if eth-usd decreases
  // hard default = SOUND -> DISABLED due to an invariant violation
  // This may require to deploy some mocks to be able to force some of these situations
  describe('Collateral Status', () => {
    // Test for hard default
    it('Updates status in case of hard default', async () => {
      // Check initial state
      await rethCollateral.refresh()
      expect(await rethCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await rethCollateral.whenDefault()).to.equal(MAX_UINT256)

      // by impersonating a rocket contract and decreasing the value which would be voted on by the ODAO
      // in rocket storage for total eth, the reth exchange rate can be decreased without using any mocks
      const rocketEtherBal: BigNumber = await rocketBalances.getTotalETHBalance()
      const lowerBal: BigNumber = rocketEtherBal.sub(fp('1000'))
      await whileImpersonating(rocketBalances.address, async (rethSigner) => {
        await rocketStorage.connect(rethSigner).setUint(rocketBalanceKey, lowerBal)
      })

      // Force updates
      await expect(rethCollateral.refresh())
        .to.emit(rethCollateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await rethCollateral.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await rethCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    })

    it('Reverts if oracle reverts or runs out of gas, maintains status', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1000e8'))
      )

      const invalidRethCollateral: RethCollateral = <RethCollateral>(
        await rethCollateralFactory.deploy(
          fp('1'),
          invalidChainlinkFeed.address,
          await rethCollateral.erc20(),
          await rethCollateral.maxTradeVolume(),
          await rethCollateral.oracleTimeout(),
          await rethCollateral.targetName(),
          await rethCollateral.delayUntilDefault()
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidRethCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidRethCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidRethCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidRethCollateral.status()).to.equal(CollateralStatus.SOUND)
    })
  })
})
