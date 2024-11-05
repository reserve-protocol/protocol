import { networkConfig } from '#/common/configuration'
import { bn, fp } from '#/common/numbers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { MockV3Aggregator } from '@typechain/MockV3Aggregator'
import { TestICollateral } from '@typechain/TestICollateral'
import { ERC20Mock, MockV3Aggregator__factory } from '@typechain/index'
import { expect } from 'chai'
import { BigNumber, BigNumberish, ContractFactory, utils } from 'ethers'
import { ethers } from 'hardhat'
import collateralTests from '../collateralTests'
import { getResetFork } from '../helpers'
import { CollateralOpts } from '../pluginTestTypes'
import { pushOracleForward } from '../../../utils/oracles'
import {
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  FORK_BLOCK,
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
} from './constants'
import hre from 'hardhat'
import { MorphoAaveCollateralFixtureContext, mintCollateralTo } from './mintCollateralTo'
import { setCode } from '@nomicfoundation/hardhat-network-helpers'
import { whileImpersonating } from '#/utils/impersonation'
import { whales } from '#/tasks/validation/utils/constants'
import { advanceBlocks, advanceTime } from '#/utils/time'

whales[networkConfig['1'].tokens.USDC!.toLowerCase()] = '0xD6153F5af5679a75cC85D8974463545181f48772'

interface MAFiatCollateralOpts extends CollateralOpts {
  underlyingToken?: string
  poolToken?: string
  defaultPrice?: BigNumberish
  defaultRefPerTok?: BigNumberish
}

const makeAaveFiatCollateralTestSuite = (
  collateralName: string,
  defaultCollateralOpts: MAFiatCollateralOpts,
  specificTests = false
) => {
  const networkConfigToUse = networkConfig[31337]
  const deployCollateral = async (opts: MAFiatCollateralOpts = {}): Promise<TestICollateral> => {
    opts = { ...defaultCollateralOpts, ...opts }

    const MorphoAAVECollateralFactory: ContractFactory = await ethers.getContractFactory(
      'MorphoFiatCollateral'
    )
    if (opts.erc20 == null) {
      const MorphoTokenisedDepositFactory = await ethers.getContractFactory(
        'MorphoAaveV2TokenisedDepositMock'
      )
      const wrapperMock = await MorphoTokenisedDepositFactory.deploy({
        morphoController: networkConfigToUse.MORPHO_AAVE_CONTROLLER!,
        morphoLens: networkConfigToUse.MORPHO_AAVE_LENS!,
        underlyingERC20: opts.underlyingToken!,
        poolToken: opts.poolToken!,
        rewardToken: networkConfigToUse.tokens.MORPHO!,
      })
      opts.erc20 = wrapperMock.address
    }

    const collateral = <TestICollateral>await MorphoAAVECollateralFactory.deploy(
      {
        erc20: opts.erc20,
        targetName: opts.targetName,
        priceTimeout: opts.priceTimeout,
        chainlinkFeed: opts.chainlinkFeed,
        oracleError: opts.oracleError,
        oracleTimeout: opts.oracleTimeout,
        maxTradeVolume: opts.maxTradeVolume,
        defaultThreshold: opts.defaultThreshold,
        delayUntilDefault: opts.delayUntilDefault,
      },
      opts.revenueHiding,
      { gasLimit: 2000000000 }
    )
    await collateral.deployed()

    // Push forward chainlink feed
    await pushOracleForward(opts.chainlinkFeed!)

    await expect(collateral.refresh())

    return collateral
  }

  type Fixture<T> = () => Promise<T>

  const makeCollateralFixtureContext = (
    alice: SignerWithAddress,
    inOpts: MAFiatCollateralOpts = {}
  ): Fixture<MorphoAaveCollateralFixtureContext> => {
    const makeCollateralFixtureContext = async () => {
      const opts = { ...defaultCollateralOpts, ...inOpts }

      const MorphoTokenisedDepositFactory = await ethers.getContractFactory(
        'MorphoAaveV2TokenisedDepositMock'
      )
      const erc20Factory = await ethers.getContractFactory('ERC20Mock')
      const underlyingErc20 = await erc20Factory.attach(opts.underlyingToken!)
      const wrapperMock = await MorphoTokenisedDepositFactory.deploy({
        morphoController: networkConfigToUse.MORPHO_AAVE_CONTROLLER!,
        morphoLens: networkConfigToUse.MORPHO_AAVE_LENS!,
        underlyingERC20: opts.underlyingToken!,
        poolToken: opts.poolToken!,
        rewardToken: networkConfigToUse.tokens.MORPHO!,
      })

      const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
        await ethers.getContractFactory('MockV3Aggregator')
      )

      const chainlinkFeed = <MockV3Aggregator>(
        await MockV3AggregatorFactory.deploy(8, opts.defaultPrice!)
      )
      const collateralOpts = {
        ...opts,
        erc20: wrapperMock.address,
        chainlinkFeed: chainlinkFeed.address,
      }

      const collateral = await deployCollateral(collateralOpts)

      return {
        alice,
        collateral,
        underlyingErc20: underlyingErc20,
        chainlinkFeed,
        tok: wrapperMock as unknown as ERC20Mock,
        morphoWrapper: wrapperMock,
      } as MorphoAaveCollateralFixtureContext
    }

    return makeCollateralFixtureContext
  }

  const reduceTargetPerRef = async (
    ctx: MorphoAaveCollateralFixtureContext,
    pctDecrease: BigNumberish
  ) => {
    const lastRound = await ctx.chainlinkFeed.latestRoundData()
    const nextAnswer = lastRound.answer.sub(lastRound.answer.mul(pctDecrease).div(100))
    await ctx.chainlinkFeed.updateAnswer(nextAnswer)
  }

  const increaseTargetPerRef = async (
    ctx: MorphoAaveCollateralFixtureContext,
    pctIncrease: BigNumberish
  ) => {
    const lastRound = await ctx.chainlinkFeed.latestRoundData()
    const nextAnswer = lastRound.answer.add(lastRound.answer.mul(pctIncrease).div(100))
    await ctx.chainlinkFeed.updateAnswer(nextAnswer)
  }

  const changeRefPerTok = async (
    ctx: MorphoAaveCollateralFixtureContext,
    percentChange: BigNumber
  ) => {
    const rate = await ctx.morphoWrapper.getExchangeRate()
    await ctx.morphoWrapper.setExchangeRate(rate.add(rate.mul(percentChange).div(bn('100'))))
  }

  // prettier-ignore
  const reduceRefPerTok = async (
    ctx: MorphoAaveCollateralFixtureContext,
    pctDecrease: BigNumberish
  ) => {
    await changeRefPerTok(
      ctx,
      bn(pctDecrease).mul(-1)
    )
  }
  // prettier-ignore
  const increaseRefPerTok = async (
    ctx: MorphoAaveCollateralFixtureContext,
    pctIncrease: BigNumberish
  ) => {
    await changeRefPerTok(
      ctx,
      bn(pctIncrease)
    )
  }
  const getExpectedPrice = async (ctx: MorphoAaveCollateralFixtureContext): Promise<BigNumber> => {
    const clData = await ctx.chainlinkFeed.latestRoundData()
    const clDecimals = await ctx.chainlinkFeed.decimals()

    const refPerTok = await ctx.collateral.refPerTok()
    return clData.answer
      .mul(bn(10).pow(18 - clDecimals))
      .mul(refPerTok)
      .div(fp('1'))
  }

  /*
    Define collateral-specific tests
  */
  const collateralSpecificConstructorTests = () => {
    it('tokenised deposits can correctly claim rewards', async () => {
      const alice = hre.ethers.provider.getSigner(1)
      const aliceAddress = await alice.getAddress()

      const forkBlock = 17574117
      const claimer = '0x05e818959c2Aa4CD05EDAe9A099c38e7Bdc377C6'
      const reset = getResetFork(forkBlock)
      await reset()
      const MorphoTokenisedDepositFactory = await ethers.getContractFactory(
        'MorphoAaveV2TokenisedDeposit'
      )
      const usdtVault = await MorphoTokenisedDepositFactory.deploy({
        morphoController: networkConfigToUse.MORPHO_AAVE_CONTROLLER!,
        morphoLens: networkConfigToUse.MORPHO_AAVE_LENS!,
        underlyingERC20: defaultCollateralOpts.underlyingToken!,
        poolToken: defaultCollateralOpts.poolToken!,
        rewardToken: networkConfigToUse.tokens.MORPHO!,
      })

      const morphoTokenOwner = '0xcBa28b38103307Ec8dA98377ffF9816C164f9AFa'
      const vaultCode = await ethers.provider.getCode(usdtVault.address)
      await setCode(claimer, vaultCode)

      const vaultWithClaimableRewards = usdtVault.attach(claimer)
      await whileImpersonating(hre, morphoTokenOwner, async (signer) => {
        const morphoTokenInst = await ethers.getContractAt(
          'IMorphoToken',
          networkConfigToUse.tokens.MORPHO!,
          signer
        )

        await morphoTokenInst
          .connect(signer)
          .setUserRole(vaultWithClaimableRewards.address, 0, true)
      })
      const erc20Factory = await ethers.getContractFactory('ERC20Mock')
      const underlyingERC20 = erc20Factory.attach(defaultCollateralOpts.underlyingToken!)
      const depositAmount = utils.parseUnits('1000', 6)

      await whileImpersonating(
        hre,
        whales[defaultCollateralOpts.underlyingToken!.toLowerCase()],
        async (whaleSigner) => {
          await underlyingERC20.connect(whaleSigner).transfer(aliceAddress, depositAmount)
        }
      )
      await underlyingERC20.connect(alice).approve(vaultWithClaimableRewards.address, 0)
      await underlyingERC20
        .connect(alice)
        .approve(vaultWithClaimableRewards.address, ethers.constants.MaxUint256)
      await vaultWithClaimableRewards.connect(alice).mint(depositAmount, aliceAddress)
      const morphoRewards = await ethers.getContractAt(
        'IMorphoRewardsDistributor',
        networkConfigToUse.MORPHO_REWARDS_DISTRIBUTOR!
      )
      await morphoRewards.claim(vaultWithClaimableRewards.address, '14162082619942089266', [
        '0x49bb35f20573d5b927c5b5c15c904839cacdf83c6119450ccb6c2ed0647aa71b',
        '0xfb9f4530177774effb7af9c1723c7087f60cd135a0cb5f409ec7bbc792a79235',
        '0x16dcb8d895b9520c20f476bfc23125aa8f47b800a3bea63b63f89abe158a16fe',
        '0x70b3bcf266272051262da958e86efb68a3621977aab0fa0205a5e47a83f3b129',
        '0xc06f6781c002b96e5860094fec5ac0692e6e39b3aafa0e02a2c9f87a993a55cb',
        '0x679aafaa2e4772160288874aa86f2f1baf6ab7409109da7ad96d3b6d5cf2c3ee',
        '0x5b9f1e5d9dfbdc65ec0166a6f1e2fe4a31396fa31739cce54962f1ed43638ff1',
        '0xb2db22839637b4c40c7ecc800df0ed8a205c9c31d7d49c41c3d105a62d1c5526',
        '0xa26071ec1b113e9033dcbccd7680617d3e75fa626b9f1c43dbc778f641f162da',
        '0x53eb58db4c07b67b3bce54b530c950a4ef0c229a3ed2506c53d7c4e31ecc6bfc',
        '0x14c512bd39f8b1d13d4cfaad2b4473c4022d01577249ecc97fbf0a64244378ee',
        '0xea8c2ee8d43e37ceb7b0c04d59106eff88afbe3e911b656dec7caebd415ea696',
      ])

      // sync needs to be called after a claim to start a new payout period
      // new tokens will only be moved into pending after a _claimAssetRewards call
      // which sync allows you to do without the other stuff that happens in claimRewards
      await vaultWithClaimableRewards.sync()

      await advanceTime(hre, 86400 * 7)
      await advanceBlocks(hre, 7200 * 7)
      expect(await vaultWithClaimableRewards.connect(alice).claimRewards())
      expect(
        await erc20Factory.attach(networkConfigToUse.tokens.MORPHO!).balanceOf(aliceAddress)
      ).to.be.eq(bn('14162082619942089266'))
    })
    it('Frontrunning claiming rewards is not economical', async () => {
      const alice = hre.ethers.provider.getSigner(1)
      const aliceAddress = await alice.getAddress()
      const bob = hre.ethers.provider.getSigner(2)
      const bobAddress = await bob.getAddress()

      const MorphoTokenisedDepositFactory = await ethers.getContractFactory(
        'MorphoAaveV2TokenisedDeposit'
      )
      const ERC20Factory = await ethers.getContractFactory('ERC20Mock')
      const mockRewardsToken = await ERC20Factory.deploy('MockMorphoReward', 'MMrp')
      const underlyingERC20 = ERC20Factory.attach(defaultCollateralOpts.underlyingToken!)

      const vault = await MorphoTokenisedDepositFactory.deploy({
        morphoController: networkConfigToUse.MORPHO_AAVE_CONTROLLER!,
        morphoLens: networkConfigToUse.MORPHO_AAVE_LENS!,
        underlyingERC20: defaultCollateralOpts.underlyingToken!,
        poolToken: defaultCollateralOpts.poolToken!,
        rewardToken: mockRewardsToken.address,
      })

      const depositAmount = utils.parseUnits('1000', 6)

      await whileImpersonating(
        hre,
        whales[defaultCollateralOpts.underlyingToken!.toLowerCase()],
        async (whaleSigner) => {
          await underlyingERC20.connect(whaleSigner).transfer(aliceAddress, depositAmount)
          await underlyingERC20.connect(whaleSigner).transfer(bobAddress, depositAmount.mul(10))
        }
      )

      await underlyingERC20.connect(alice).approve(vault.address, ethers.constants.MaxUint256)
      await vault.connect(alice).mint(depositAmount, aliceAddress)

      // Simulate inflation attack
      await underlyingERC20.connect(bob).approve(vault.address, ethers.constants.MaxUint256)
      await vault.connect(bob).mint(depositAmount.mul(10), bobAddress)

      await mockRewardsToken.mint(vault.address, bn('1000000000000000000000'))
      await vault.sync()

      await vault.connect(bob).claimRewards()
      await vault.connect(bob).redeem(depositAmount.mul(10), bobAddress, bobAddress)

      // After the inflation attack
      await advanceTime(hre, 86400 * 7)
      await advanceBlocks(hre, 7200 * 7)
      await vault.connect(alice).claimRewards()

      // Shown below is that it is no longer economical to inflate own shares
      // bob only managed to steal approx 1/7200 * 90% of the reward because hardhat increments block by 1
      // in practise it would be 0 as inflation attacks typically flashloan assets.
      expect(await mockRewardsToken.balanceOf(aliceAddress)).to.be.closeTo(
        bn('999996993746993746995'),
        bn('1e15')
      )
      expect(await mockRewardsToken.balanceOf(bobAddress)).to.be.closeTo(
        bn('1503126503126502'),
        bn('1e12')
      )
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const collateralSpecificStatusTests = () => {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const beforeEachRewardsTest = async () => {}

  const opts = {
    deployCollateral,
    collateralSpecificConstructorTests: specificTests
      ? collateralSpecificConstructorTests
      : () => void 0,
    collateralSpecificStatusTests,
    beforeEachRewardsTest,
    makeCollateralFixtureContext,
    mintCollateralTo,
    reduceTargetPerRef,
    increaseTargetPerRef,
    reduceRefPerTok,
    increaseRefPerTok,
    getExpectedPrice,
    itClaimsRewards: it.skip,
    itChecksTargetPerRefDefault: it,
    itChecksTargetPerRefDefaultUp: it,
    itChecksRefPerTokDefault: it,
    itChecksPriceChanges: it,
    itChecksNonZeroDefaultThreshold: it,
    itHasRevenueHiding: it,
    resetFork: getResetFork(FORK_BLOCK),
    collateralName,
    chainlinkDefaultAnswer: defaultCollateralOpts.defaultPrice!,
    itIsPricedByPeg: true,
  }

  collateralTests(opts)
}

const makeOpts = (
  underlyingToken: string,
  poolToken: string,
  chainlinkFeed: string
): MAFiatCollateralOpts => {
  return {
    targetName: ethers.utils.formatBytes32String('USD'),
    priceTimeout: PRICE_TIMEOUT,
    oracleTimeout: ORACLE_TIMEOUT,
    oracleError: ORACLE_ERROR,
    defaultThreshold: DEFAULT_THRESHOLD,
    delayUntilDefault: DELAY_UNTIL_DEFAULT,
    maxTradeVolume: bn(1000000),
    revenueHiding: fp('0'),
    defaultPrice: bn('1e8'),
    defaultRefPerTok: fp('1'),
    underlyingToken,
    poolToken,
    chainlinkFeed,
  }
}

/*
  Run the test suite
*/
const { tokens, chainlinkFeeds } = networkConfig[31337]
// makeAaveFiatCollateralTestSuite(
//   'MorphoAAVEV2FiatCollateral - USDT',
//   makeOpts(tokens.USDT!, tokens.aUSDT!, chainlinkFeeds.USDT!),
//   true // Only run specific tests once, since they are slow
// )
makeAaveFiatCollateralTestSuite(
  'MorphoAAVEV2FiatCollateral - USDC',
  makeOpts(tokens.USDC!, tokens.aUSDC!, chainlinkFeeds.USDC!)
)
// makeAaveFiatCollateralTestSuite(
//   'MorphoAAVEV2FiatCollateral - DAI',
//   makeOpts(tokens.DAI!, tokens.aDAI!, chainlinkFeeds.DAI!)
// )
