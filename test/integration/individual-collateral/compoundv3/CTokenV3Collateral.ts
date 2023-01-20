import { expect } from 'chai'
import hre, { ethers, waffle } from 'hardhat'
import {
  InvalidMockV3Aggregator,
  CusdcV3Wrapper,
  CusdcV3Wrapper__factory,
  CTokenV3Collateral,
  MockV3Aggregator,
  ERC20Mock,
  CometInterface
} from '../../../../typechain'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  ORACLE_TIMEOUT,
  CollateralStatus,
  allocateUSDC,
  mintWcUSDC,
  REWARDS,
  COMP,
  CUSDC_V3,
  ORACLE_ERROR
} from './helpers'
import { deployCollateral, makeCollateral, makeCollateralCometMock, defaultCollateralOpts } from './fixtures'
import { advanceTime, advanceBlocks, getLatestBlockTimestamp, setNextBlockTimestamp } from '../../../utils/time'
import { ContractFactory, Wallet } from 'ethers'
import { useEnv } from '#/utils/env'
import { getChainId } from '../../../../common/blockchain-utils'
import {
  networkConfig,
} from '../../../../common/configuration'
import { bn, fp, toBNDecimals } from '../../../../common/numbers'
import { MAX_UINT48, MAX_UINT192 } from '../../../../common/constants'

const describeFork = useEnv('FORK') ? describe : describe.skip

const createFixtureLoader = waffle.createFixtureLoader

describeFork('CTokenV3Collateral', () => {
  describe('constructor validation', () => {
    it('validates targetName', async () => {
      const CTokenV3CollateralFactory: ContractFactory = await ethers.getContractFactory(
        'CTokenV3Collateral'
      )
      const opts1 = {
        erc20: CUSDC_V3,
        targetName: ethers.constants.HashZero,
        priceTimeout: defaultCollateralOpts.priceTimeout,
        chainlinkFeed: defaultCollateralOpts.chainlinkFeed,
        oracleError: defaultCollateralOpts.oracleError,
        oracleTimeout: defaultCollateralOpts.oracleTimeout,
        maxTradeVolume: defaultCollateralOpts.maxTradeVolume,
        defaultThreshold: defaultCollateralOpts.defaultThreshold,
        delayUntilDefault: defaultCollateralOpts.delayUntilDefault,
      }
      const opts2 = {
        rewardERC20: defaultCollateralOpts.rewardERC20,
        reservesThresholdIffy: defaultCollateralOpts.reservesThresholdIffy,
        reservesThresholdDisabled: defaultCollateralOpts.reservesThresholdDisabled,
      }
      
      await expect(CTokenV3CollateralFactory.deploy(opts1, opts2)).to.be.revertedWith('targetName missing')
    })
  
    it('does not allow missing ERC20', async () => {
      await expect(deployCollateral({ erc20: ethers.constants.AddressZero })).to.be.revertedWith(
        'missing erc20'
      )
    })
  
    it('does not allow missing chainlink feed', async () => {
      await expect(
        deployCollateral({ erc20: CUSDC_V3, chainlinkFeed: ethers.constants.AddressZero })
      ).to.be.revertedWith('missing chainlink feed')
    })
  
    it('max trade volume must be greater than zero', async () => {
      await expect(deployCollateral({ erc20: CUSDC_V3, maxTradeVolume: 0 })).to.be.revertedWith(
        'invalid max trade volume'
      )
    })
  
    it('does not allow oracle timeout at 0', async () => {
      await expect(deployCollateral({ erc20: CUSDC_V3, oracleTimeout: 0 })).to.be.revertedWith(
        'oracleTimeout zero'
      )
    })
  
    it('does not allow missing delayUntilDefault if defaultThreshold > 0', async () => {
      await expect(deployCollateral({ erc20: CUSDC_V3, delayUntilDefault: 0 })).to.be.revertedWith(
        'delayUntilDefault zero'
      )
    })
  
    it('does not allow missing rewardERC20', async () => {
      await expect(
        deployCollateral({ erc20: CUSDC_V3, rewardERC20: ethers.constants.AddressZero })
      ).to.be.revertedWith('rewardERC20 missing')
    })
  
    it('does not allow 0 reservesThresholdIffy', async () => {
      await expect(
        deployCollateral({ erc20: CUSDC_V3, reservesThresholdIffy: 0 })
      ).to.be.revertedWith('reservesThresholdIffy zero')
    })
  
    it('does not allow 0 reservesThresholdDisabled', async () => {
      await expect(
        deployCollateral({ erc20: CUSDC_V3, reservesThresholdDisabled: 0 })
      ).to.be.revertedWith('reservesThresholdDisabled zero')
    })
  })

  describe('collateral functionality', () => {
    let owner: SignerWithAddress;
    let bob: SignerWithAddress;
    let charles: SignerWithAddress;
    let don: SignerWithAddress
  
    let wallet: Wallet
    let chainId: number

    let usdc: ERC20Mock;
    let wcusdcV3: CusdcV3Wrapper;
    let cusdcV3: CometInterface;
    let collateral: CTokenV3Collateral
    let chainlinkFeed: MockV3Aggregator
  
    let loadFixture: ReturnType<typeof createFixtureLoader>
  
    before(async () => {
      ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
      loadFixture = createFixtureLoader([wallet])
  
      chainId = await getChainId(hre)
      if (!networkConfig[chainId]) {
        throw new Error(`Missing network configuration for ${hre.network.name}`)
      }
    })
  
    beforeEach(async () => {
      ;[owner, bob, charles, don] = await ethers.getSigners()
      ;({
        usdc,
        wcusdcV3,
        cusdcV3,
        collateral,
        chainlinkFeed
      } = await loadFixture(makeCollateral()))
    })

    describe('prices', () => {
      it('prices change as USDC feed price changes', async () => {
        const { answer } = await chainlinkFeed.latestRoundData()
        const decimals = await chainlinkFeed.decimals()
        const expectedPrice = answer.mul(bn(10).pow(18 - decimals))
        const expectedDelta = expectedPrice.mul(ORACLE_ERROR).div(fp(1))
    
        // Check initial prices
        const [initLow, initHigh] = await collateral.price()
        expect(initLow).to.equal(expectedPrice.sub(expectedDelta))
        expect(initHigh).to.equal(expectedPrice.add(expectedDelta))
    
        // Check refPerTok initial values
        const expectedRefPerTok = bn('1e18')
        expect(await collateral.refPerTok()).to.equal(expectedRefPerTok) // should equal 1e18
    
        // Update values in Oracles increase by 10-20%
        const newPrice = bn('11e6')
        const updateAnswerTx = await chainlinkFeed.updateAnswer(newPrice)
        await updateAnswerTx.wait()
    
        // Check new prices
        const newExpectedPrice = newPrice.mul(bn(10).pow(18 - decimals))
        const newExpectedDelta = newExpectedPrice.mul(ORACLE_ERROR).div(fp(1))
        const [newLow, newHigh] = await collateral.price()
        expect(newLow).to.equal(newExpectedPrice.sub(newExpectedDelta))
        expect(newHigh).to.equal(newExpectedPrice.add(newExpectedDelta))
    
        // Check refPerTok remains the same
        expect(await collateral.refPerTok()).to.equal(expectedRefPerTok)
      })
    
      it('prices change as refPerTok changes', async () => {
        const prevRefPerTok = await collateral.refPerTok()
        expect(prevRefPerTok).to.equal(bn('1e18'))

        const decimals = await chainlinkFeed.decimals()

        const initData = await chainlinkFeed.latestRoundData()
        const expectedPrice = initData.answer.mul(bn(10).pow(18 - decimals))
        const expectedDelta = expectedPrice.mul(ORACLE_ERROR).div(fp(1))
        const [initLow, initHigh] = await collateral.price()
        expect(initLow).to.equal(expectedPrice.sub(expectedDelta))
        expect(initHigh).to.equal(expectedPrice.add(expectedDelta))
    
        const usdcAsB = usdc.connect(bob)
        const cusdcV3AsB = cusdcV3.connect(bob)
        const wcusdcV3AsB = wcusdcV3.connect(bob)
    
        // need to deposit in order to get an exchange rate
        const balance = bn('20000e6')
        await allocateUSDC(bob.address, balance)
        await usdcAsB.approve(cusdcV3.address, ethers.constants.MaxUint256)
        await cusdcV3AsB.supply(usdc.address, balance)
        expect(await usdc.balanceOf(bob.address)).to.equal(0)
        await cusdcV3AsB.allow(wcusdcV3.address, true)
        await wcusdcV3AsB.depositTo(bob.address, ethers.constants.MaxUint256)

        await advanceBlocks(1000)
        await advanceTime(12000)
    
        expect(await collateral.refPerTok()).to.be.gt(prevRefPerTok)

        const [newLow, newHigh] = await collateral.price()
        expect(newLow).to.be.gt(initLow)
        expect(newHigh).to.be.gt(initHigh)
      })
    
      it('returns a 0 price', async () => {
        // Set price of USDC to 0
        const updateAnswerTx = await chainlinkFeed.updateAnswer(0)
        await updateAnswerTx.wait()
    
        // (0, FIX_MAX) is returned
        const [low, high] = await collateral.price()
        expect(low).to.equal(0)
        expect(high).to.equal(0)
    
        // When refreshed, sets status to Unpriced
        await collateral.refresh()
        expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
      })
    
      it('reverts in case of invalid timestamp', async () => {
        await chainlinkFeed.setInvalidTimestamp()
    
        // Check price of token
        const [low, high] = await collateral.price()
        expect(low).to.equal(0)
        expect(high).to.equal(MAX_UINT192)

        // When refreshed, sets status to Unpriced
        await collateral.refresh()
        expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
      })
    })
    
    describe('status', () => {
      it('maintains status in normal situations', async () => {
        // Check initial state
        expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
        expect(await collateral.whenDefault()).to.equal(MAX_UINT48)
    
        // Force updates (with no changes)
        await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')
    
        // State remains the same
        expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
        expect(await collateral.whenDefault()).to.equal(MAX_UINT48)
      })
    
      it('soft-defaults when reference unit depegs beyond threshold', async () => {
        const { collateral, chainlinkFeed } = await loadFixture(makeCollateralCometMock())
        const delayUntilDefault = (await collateral.delayUntilDefault())
    
        // Check initial state
        expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
        expect(await collateral.whenDefault()).to.equal(MAX_UINT48)
    
        // Depeg USDC:USD - Reducing price by 20% from 1 to 0.8
        const updateAnswerTx = await chainlinkFeed.updateAnswer(bn('8e5'))
        await updateAnswerTx.wait()
    
        // Force updates - Should update whenDefault and status
        let expectedDefaultTimestamp: number
    
        // Set next block timestamp - for deterministic result
        const nextBlockTimestamp = (await getLatestBlockTimestamp()) + 1
        await setNextBlockTimestamp(nextBlockTimestamp)
        expectedDefaultTimestamp = nextBlockTimestamp + delayUntilDefault
    
        await expect(collateral.refresh())
          .to.emit(collateral, 'CollateralStatusChanged')
          .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
        expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
        expect(await collateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    
        // Move time forward past delayUntilDefault
        await advanceTime(delayUntilDefault)
        expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
    
        // Nothing changes if attempt to refresh after default for CTokenV3
        let prevWhenDefault: bigint = (await collateral.whenDefault()).toBigInt()
        await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')
        expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
        expect(await collateral.whenDefault()).to.equal(prevWhenDefault)
      })
    
      it('soft-defaults when compound reserves are below target reserves iffy threshold', async () => {
        const { collateral, cusdcV3 } = await loadFixture(
          makeCollateralCometMock({ reservesThresholdIffy: 5000n, reservesThresholdDisabled: 1000n })
        )
        const delayUntilDefault = await collateral.delayUntilDefault()
    
        // Check initial state
        await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')
        expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
        expect(await collateral.whenDefault()).to.equal(MAX_UINT48)
    
        // cUSDC/Comet's reserves gone down below reservesThresholdIffy
        await cusdcV3.setReserves(4000n)
    
        const nextBlockTimestamp = (await getLatestBlockTimestamp()) + 1
        await setNextBlockTimestamp(nextBlockTimestamp)
        const expectedDefaultTimestamp = nextBlockTimestamp + delayUntilDefault
    
        await expect(collateral.refresh())
          .to.emit(collateral, 'CollateralStatusChanged')
          .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
        expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
        expect(await collateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    
        // Move time forward past delayUntilDefault
        await advanceTime(delayUntilDefault)
        expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
    
        // Nothing changes if attempt to refresh after default for CTokenV3
        let prevWhenDefault: bigint = (await collateral.whenDefault()).toBigInt()
        await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')
        expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
        expect(await collateral.whenDefault()).to.equal(prevWhenDefault)
      })
    
      it('hard-defaults when refPerTok() decreases', async () => {    
        // Check initial state
        expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
        expect(await collateral.whenDefault()).to.equal(MAX_UINT48)
    
        await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'))
    
        await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')
        // State remains the same
        expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
        expect(await collateral.whenDefault()).to.equal(MAX_UINT48)
    
        // Force refresh to get new reference price from exchange rate
        await advanceTime(1000)
        const oldExchangeRate = await wcusdcV3.exchangeRate()
        await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')
    
        // Withdraw ~99% of supply so that exchange rate will go down
        await wcusdcV3.connect(bob).withdraw(bn('19900e6'))
        expect(oldExchangeRate).to.be.gt(await wcusdcV3.exchangeRate())
    
        // Collateral defaults due to refPerTok() going down
        await expect(collateral.refresh()).to.emit(collateral, 'CollateralStatusChanged')
        expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
        expect(await collateral.whenDefault()).to.equal(await getLatestBlockTimestamp())
      })
    
      it('hard-defaults when reserves threshold is at disabled levels', async () => {
        const { collateral, cusdcV3 } = await loadFixture(
          makeCollateralCometMock({ reservesThresholdDisabled: 1000n })
        )
        const [_, bob] = await ethers.getSigners()
    
        // Check initial state
        expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
        expect(await collateral.whenDefault()).to.equal(MAX_UINT48)
    
        // cUSDC/Comet's reserves gone down to 19% of target reserves
        await cusdcV3.setReserves(900n)
    
        await expect(collateral.refresh()).to.emit(collateral, 'CollateralStatusChanged')
        // State remains the same
        expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
        expect(await collateral.whenDefault()).to.equal(await getLatestBlockTimestamp())
      })
    
      it('enters IFFY state when price becomes stale', async () => {
        await advanceTime(ORACLE_TIMEOUT.toString())
        await collateral.refresh()
        expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
      })
    
      it('reverts if Chainlink feed reverts or runs out of gas, maintains status', async () => {
        const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
          'InvalidMockV3Aggregator'
        )
        const invalidChainlinkFeed = <InvalidMockV3Aggregator>(
          await InvalidMockV3AggregatorFactory.deploy(6, bn('1e6'))
        )
    
        const CusdcV3WrapperFactory = <CusdcV3Wrapper__factory>(
          await ethers.getContractFactory('CusdcV3Wrapper')
        )
        const wcusdcV3 = <CusdcV3Wrapper>await CusdcV3WrapperFactory.deploy(CUSDC_V3, REWARDS, COMP)
    
        const invalidCollateral = await deployCollateral({
          erc20: wcusdcV3.address,
          chainlinkFeed: invalidChainlinkFeed.address,
        })
    
        // Reverting with no reason
        await invalidChainlinkFeed.setSimplyRevert(true)
        await expect(invalidCollateral.refresh()).to.be.revertedWithoutReason()
        expect(await invalidCollateral.status()).to.equal(CollateralStatus.SOUND)
    
        // Runnning out of gas (same error)
        await invalidChainlinkFeed.setSimplyRevert(false)
        await expect(invalidCollateral.refresh()).to.be.revertedWithoutReason()
        expect(await invalidCollateral.status()).to.equal(CollateralStatus.SOUND)
      })
    })
  })
})

