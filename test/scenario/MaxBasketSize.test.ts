import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { bn, fp } from '../../common/numbers'
import {
  AaveLendingPoolMock,
  AaveOracleMock,
  AavePricedFiatCollateral,
  ATokenFiatCollateral,
  CompoundOracleMock,
  ComptrollerMock,
  CTokenFiatCollateral,
  CTokenMock,
  ERC20Mock,
  Facade,
  IBasketHandler,
  StaticATokenMock,
  TestIAssetRegistry,
  TestIBackingManager,
  TestIRToken,
} from '../../typechain'
import { advanceTime, getLatestBlockTimestamp } from '../utils/time'
import { defaultFixture, IConfig, IMPLEMENTATION } from '../fixtures'
import { CollateralStatus } from '../../common/constants'
import snapshotGasCost from '../utils/snapshotGasCost'
import { expectTrade } from '../utils/trades'
import { expectEvents } from '../../common/events'

const DEFAULT_THRESHOLD = fp('0.05') // 5%
const DELAY_UNTIL_DEFAULT = bn('86400') // 24h

const createFixtureLoader = waffle.createFixtureLoader

describe(`Max Basket Size - P${IMPLEMENTATION}`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Non-backing assets
  let compoundMock: ComptrollerMock
  let compoundOracleInternal: CompoundOracleMock
  let compToken: ERC20Mock
  let aaveMock: AaveLendingPoolMock
  let aaveOracleInternal: AaveOracleMock
  let aaveToken: ERC20Mock

  // Tokens and Assets
  let initialBal: BigNumber
  let rewardAmount: BigNumber

  // Config values
  let config: IConfig

  // Contracts to retrieve after deploy
  let rToken: TestIRToken
  let assetRegistry: TestIAssetRegistry
  let basketHandler: IBasketHandler
  let facade: Facade
  let backingManager: TestIBackingManager

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  const setBasket = async (
    maxBasketSize: number,
    numBackupTokens: number,
    onlyFiatcoins: boolean
  ) => {
    const basketTargetAmt = fp('1')
    const primeERC20s = []
    const targetAmts = []

    if (onlyFiatcoins) {
      for (let i = 0; i < maxBasketSize; i++) {
        const erc20 = await makeToken(`Token ${i}`)
        primeERC20s.push(erc20.address)
        targetAmts.push(basketTargetAmt.div(maxBasketSize))
      }
    } else {
      const numATokens = Math.ceil(maxBasketSize / 2)

      // Make half of basket ATokens
      let i = 0
      for (i; i < numATokens; i++) {
        const erc20 = await makeAToken(`Token ${i}`)
        primeERC20s.push(erc20.address)
        targetAmts.push(basketTargetAmt.div(maxBasketSize))
      }

      // Make the other half CTokens
      for (i; i < maxBasketSize; i++) {
        const erc20 = await makeCToken(`Token ${i}`)
        primeERC20s.push(erc20.address)
        targetAmts.push(basketTargetAmt.div(maxBasketSize))
      }
    }

    // Set backup
    const backups: string[] = []
    for (let i = 0; i < numBackupTokens; i++) {
      // reuse erc20 if possible
      const erc20Addr = i < maxBasketSize ? primeERC20s[i] : (await makeToken(`Token ${i}`)).address
      backups.push(erc20Addr)
    }
    const targetUnit = ethers.utils.formatBytes32String('USD')
    await basketHandler.setBackupConfig(targetUnit, maxBasketSize, backups)

    // Set prime basket with all collateral
    await basketHandler.setPrimeBasket(primeERC20s, targetAmts)
    await basketHandler.connect(owner).refreshBasket()
  }

  const makeToken = async (tokenName: string): Promise<ERC20Mock> => {
    const ERC20MockFactory: ContractFactory = await ethers.getContractFactory('ERC20Mock')
    const AaveCollateralFactory: ContractFactory = await ethers.getContractFactory(
      'AavePricedFiatCollateral'
    )

    const erc20: ERC20Mock = <ERC20Mock>(
      await ERC20MockFactory.deploy(tokenName, `${tokenName} symbol`)
    )
    const collateral: AavePricedFiatCollateral = <AavePricedFiatCollateral>(
      await AaveCollateralFactory.deploy(
        erc20.address,
        config.maxTradeVolume,
        DEFAULT_THRESHOLD,
        DELAY_UNTIL_DEFAULT,
        compoundMock.address,
        aaveMock.address
      )
    )

    await assetRegistry.register(collateral.address)
    await aaveOracleInternal.setPrice(erc20.address, bn('2.5e14'))
    return erc20
  }

  const makeAToken = async (tokenName: string): Promise<StaticATokenMock> => {
    const ERC20MockFactory: ContractFactory = await ethers.getContractFactory('ERC20Mock')
    const ATokenMockFactory: ContractFactory = await ethers.getContractFactory('StaticATokenMock')
    const ATokenCollateralFactory: ContractFactory = await ethers.getContractFactory(
      'ATokenFiatCollateral'
    )

    const erc20: ERC20Mock = <ERC20Mock>(
      await ERC20MockFactory.deploy(tokenName, `${tokenName} symbol`)
    )

    const atoken: StaticATokenMock = <StaticATokenMock>(
      await ATokenMockFactory.deploy('a' + tokenName, `${'a' + tokenName} symbol`, erc20.address)
    )

    // Set reward token and rewards
    await atoken.setAaveToken(aaveToken.address)
    await atoken.setRewards(backingManager.address, rewardAmount)

    const collateral: ATokenFiatCollateral = <ATokenFiatCollateral>(
      await ATokenCollateralFactory.deploy(
        atoken.address,
        config.maxTradeVolume,
        DEFAULT_THRESHOLD,
        DELAY_UNTIL_DEFAULT,
        erc20.address,
        compoundMock.address,
        aaveMock.address,
        aaveToken.address
      )
    )

    await assetRegistry.register(collateral.address)
    await aaveOracleInternal.setPrice(erc20.address, bn('2.5e14'))
    return atoken
  }

  const makeCToken = async (tokenName: string): Promise<CTokenMock> => {
    const ERC20MockFactory: ContractFactory = await ethers.getContractFactory('ERC20Mock')
    const CTokenMockFactory: ContractFactory = await ethers.getContractFactory('CTokenMock')
    const CTokenCollateralFactory: ContractFactory = await ethers.getContractFactory(
      'CTokenFiatCollateral'
    )

    const erc20: ERC20Mock = <ERC20Mock>(
      await ERC20MockFactory.deploy(tokenName, `${tokenName} symbol`)
    )

    const ctoken: CTokenMock = <CTokenMock>(
      await CTokenMockFactory.deploy('c' + tokenName, `${'c' + tokenName} symbol`, erc20.address)
    )

    const collateral: CTokenFiatCollateral = <CTokenFiatCollateral>(
      await CTokenCollateralFactory.deploy(
        ctoken.address,
        config.maxTradeVolume,
        DEFAULT_THRESHOLD,
        DELAY_UNTIL_DEFAULT,
        erc20.address,
        compoundMock.address,
        compToken.address
      )
    )

    await assetRegistry.register(collateral.address)
    await compoundOracleInternal.setPrice(await erc20.symbol(), bn('1e6'))

    return ctoken
  }

  const prepareBacking = async (backing: string[]) => {
    for (let i = 0; i < backing.length; i++) {
      const erc20 = await ethers.getContractAt('ERC20Mock', backing[i])
      await erc20.mint(addr1.address, initialBal)
      await erc20.connect(addr1).approve(rToken.address, initialBal)

      // Grant allowances
      await backingManager.grantRTokenAllowance(erc20.address)
    }
  }

  before('create fixture loader', async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1] = await ethers.getSigners()

    // Deploy fixture
    ;({
      compoundMock,
      compoundOracleInternal,
      compToken,
      aaveMock,
      aaveOracleInternal,
      aaveToken,
      config,
      rToken,
      assetRegistry,
      backingManager,
      basketHandler,
      facade,
    } = await loadFixture(defaultFixture))

    // Mint initial balances
    initialBal = bn('10000e18')
    rewardAmount = bn('0.5e18')
  })

  describe('Fiatcoins', function () {
    const maxBasketSize = 100
    const numBackupTokens = 1
    const tokensToDefault = 99

    beforeEach(async () => {
      // Setup Max Basket - Only fiatcoins = true
      await setBasket(maxBasketSize, numBackupTokens, true)
    })

    it('Should Issue/Redeem with max basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCapitalized()).to.equal(true)
      const backing: string[] = await facade.basketTokens(rToken.address)
      expect(backing.length).to.equal(maxBasketSize)

      // Check other values
      expect((await basketHandler.lastSet())[0]).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.price()).to.equal(fp('1'))
      expect(await facade.callStatic.totalAssetValue(rToken.address)).to.equal(0)

      // Check RToken price
      expect(await rToken.price()).to.equal(fp('1'))

      // Mint and approve initial balances
      await prepareBacking(backing)

      // Issue
      const issueAmt = initialBal.div(100)
      if (process.env.REPORT_GAS) {
        await snapshotGasCost(rToken.connect(addr1).issue(issueAmt))
      } else {
        await rToken.connect(addr1).issue(issueAmt)
      }
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmt)

      // Redemption
      if (process.env.REPORT_GAS) {
        await snapshotGasCost(rToken.connect(addr1).redeem(issueAmt))
      } else {
        await rToken.connect(addr1).redeem(issueAmt)
      }
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
    })

    it('Should switch basket correctly', async () => {
      const backing = await facade.basketTokens(rToken.address)

      // Mint and approve initial balances
      await prepareBacking(backing)

      // Issue
      const issueAmt = initialBal.div(100)
      await rToken.connect(addr1).issue(issueAmt)

      // Basket Swapping
      const firstCollateral = await ethers.getContractAt(
        'AavePricedFiatCollateral',
        await assetRegistry.toColl(backing[0])
      )
      for (let i = maxBasketSize - tokensToDefault; i < backing.length; i++) {
        await aaveOracleInternal.setPrice(backing[i], bn('1.25e14'))
        const erc20Collateral = await ethers.getContractAt(
          'AavePricedFiatCollateral',
          await assetRegistry.toColl(backing[i])
        )

        // Mark Collateral as IFFY
        await erc20Collateral.refresh()
        expect(await erc20Collateral.status()).to.equal(CollateralStatus.IFFY)
      }
      expect(await firstCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Advance time post delayUntilDefault
      await advanceTime(DELAY_UNTIL_DEFAULT.toString())

      // Confirm default
      for (let i = 1; i < backing.length; i++) {
        const erc20Collateral = await ethers.getContractAt(
          'AavePricedFiatCollateral',
          await assetRegistry.toColl(backing[i])
        )
        // Confirm default
        await erc20Collateral.refresh()
        expect(await erc20Collateral.status()).to.equal(CollateralStatus.DISABLED)
      }
      expect(await firstCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Ensure valid basket
      if (process.env.REPORT_GAS) {
        await snapshotGasCost(basketHandler.refreshBasket())
      } else {
        await basketHandler.refreshBasket()
      }

      // Check new basket
      expect(await basketHandler.fullyCapitalized()).to.equal(false)
      const newBacking: string[] = await facade.basketTokens(rToken.address)
      expect(newBacking.length).to.equal(maxBasketSize - tokensToDefault)
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)

      // Running auctions will trigger recapitalization - All balance of invalid tokens will be redeemed
      const firstDefaultedToken = await ethers.getContractAt('ERC20Mock', backing[1])

      const sellAmt: BigNumber = await firstDefaultedToken.balanceOf(backingManager.address)

      if (process.env.REPORT_GAS) {
        await snapshotGasCost(facade.runAuctionsForAllTraders(rToken.address))
      } else {
        await expect(facade.runAuctionsForAllTraders(rToken.address))
          .to.emit(backingManager, 'TradeStarted')
          .withArgs(firstDefaultedToken.address, backing[0], sellAmt, bn('0'))
      }
      const auctionTimestamp = await getLatestBlockTimestamp()

      // Token1 -> Token0 (Only valid backup token)
      await expectTrade(backingManager, {
        sell: firstDefaultedToken.address,
        buy: backing[0],
        endTime: auctionTimestamp + Number(config.auctionLength),
        externalId: bn('0'),
      })
    })
  })

  describe('ATokens/CTokens', function () {
    const maxBasketSize = 100
    const numBackupTokens = 20
    const tokensToDefault = 20

    beforeEach(async () => {
      // Setup Max Basket - Only fiatcoins = false (use Atokens/CTokens)
      await setBasket(maxBasketSize, numBackupTokens, false)
    })

    it('Should Issue/Redeem with max basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCapitalized()).to.equal(true)
      const backing: string[] = await facade.basketTokens(rToken.address)
      expect(backing.length).to.equal(maxBasketSize)

      // Check other values
      expect((await basketHandler.lastSet())[0]).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.price()).to.equal(fp('1'))
      expect(await facade.callStatic.totalAssetValue(rToken.address)).to.equal(0)

      // Check RToken price
      expect(await rToken.price()).to.equal(fp('1'))

      // Mint and approve initial balances
      await prepareBacking(backing)

      // Issue
      const issueAmt = initialBal.div(100)
      if (process.env.REPORT_GAS) {
        await snapshotGasCost(rToken.connect(addr1).issue(issueAmt))
      } else {
        await rToken.connect(addr1).issue(issueAmt)
      }
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmt)

      // Redemption
      if (process.env.REPORT_GAS) {
        await snapshotGasCost(rToken.connect(addr1).redeem(issueAmt))
      } else {
        await rToken.connect(addr1).redeem(issueAmt)
      }
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
    })

    it('Should switch basket correctly', async () => {
      const backing = await facade.basketTokens(rToken.address)

      // Mint and approve initial balances
      await prepareBacking(backing)

      // Issue
      const issueAmt = initialBal.div(100)
      await rToken.connect(addr1).issue(issueAmt)

      // Basket Swapping - Default CTokens
      // Will be replaced by existing ATokens
      const firstCollateral = await ethers.getContractAt(
        'ATokenFiatCollateral',
        await assetRegistry.toColl(backing[0])
      )
      for (let i = maxBasketSize - tokensToDefault; i < backing.length; i++) {
        const erc20 = await ethers.getContractAt('CTokenMock', backing[i])
        // Decrease rate to cause default in Ctoken
        await erc20.setExchangeRate(fp('0.8'))

        const erc20Collateral = await ethers.getContractAt(
          'CTokenFiatCollateral',
          await assetRegistry.toColl(erc20.address)
        )

        // Mark Collateral as Defaulted
        await erc20Collateral.refresh()
        expect(await erc20Collateral.status()).to.equal(CollateralStatus.DISABLED)
      }
      expect(await firstCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Advance time post delayUntilDefault
      await advanceTime(DELAY_UNTIL_DEFAULT.toString())

      // Ensure valid basket
      if (process.env.REPORT_GAS) {
        await snapshotGasCost(basketHandler.refreshBasket())
      } else {
        await basketHandler.refreshBasket()
      }

      // Check new basket
      expect(await basketHandler.fullyCapitalized()).to.equal(false)
      const newBacking: string[] = await facade.basketTokens(rToken.address)
      expect(newBacking.length).to.equal(maxBasketSize - tokensToDefault)
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)

      // Running auctions will trigger recapitalization - All balance of invalid tokens will be redeemed
      const firstDefaultedToken = await ethers.getContractAt(
        'ERC20Mock',
        backing[maxBasketSize - tokensToDefault]
      )
      const sellAmt: BigNumber = await firstDefaultedToken.balanceOf(backingManager.address)

      if (process.env.REPORT_GAS) {
        await snapshotGasCost(facade.runAuctionsForAllTraders(rToken.address))
      } else {
        await expect(facade.runAuctionsForAllTraders(rToken.address))
          .to.emit(backingManager, 'TradeStarted')
          .withArgs(firstDefaultedToken.address, backing[0], sellAmt, bn('0'))
      }
      const auctionTimestamp = await getLatestBlockTimestamp()

      // Defaulted -> Token0 (First valid backup token)
      await expectTrade(backingManager, {
        sell: firstDefaultedToken.address,
        buy: backing[0],
        endTime: auctionTimestamp + Number(config.auctionLength),
        externalId: bn('0'),
      })
    })

    it('Should claim rewards correctly', async () => {
      // COMP Rewards - Set only once
      await compoundMock.setRewards(backingManager.address, rewardAmount.mul(20))

      // Check balances before
      expect(await aaveToken.balanceOf(backingManager.address)).to.equal(0)
      expect(await compToken.balanceOf(backingManager.address)).to.equal(0)

      // Claim Rewards
      if (process.env.REPORT_GAS) {
        await snapshotGasCost(backingManager.claimAndSweepRewards())
      } else {
        await expectEvents(backingManager.claimAndSweepRewards(), [
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [compToken.address, rewardAmount.mul(20)],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [aaveToken.address, rewardAmount],
            emitted: true,
          },
        ])
      }

      // Check balances after
      expect(await aaveToken.balanceOf(backingManager.address)).to.equal(
        rewardAmount.mul(Math.ceil(maxBasketSize / 2))
      )
      expect(await compToken.balanceOf(backingManager.address)).to.equal(rewardAmount.mul(20))
    })
  })
})
