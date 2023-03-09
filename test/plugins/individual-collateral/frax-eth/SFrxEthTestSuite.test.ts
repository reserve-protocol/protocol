import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { resetFork, mintsfrxETH } from './helpers'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumberish } from 'ethers'
import {
  MockV3Aggregator,
  MockV3Aggregator__factory,
  ICollateral,
  IReth,
  WETH9,
  ERC20Mock,
  IsfrxEth
} from '../../../../typechain'
import { bn, fp } from '../../../../common/numbers'
import { ZERO_ADDRESS } from '../../../../common/constants'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  WETH,
  FRX_ETH,
  SFRX_ETH,
  ETH_USD_PRICE_FEED,
  FRX_ETH_MINTER
} from './constants'
import { whileImpersonating } from '../../../utils/impersonation'
import { advanceTime, setNextBlockTimestamp, getLatestBlockTimestamp, advanceBlocks } from '../../../utils/time';

/*
  Define interfaces
*/

interface SFrxEthCollateralFixtureContext extends CollateralFixtureContext {
  frxEth: ERC20Mock
  sfrxEth: IsfrxEth
}

/*
  Define deployment functions
*/

export const defaultRethCollateralOpts: CollateralOpts = {
  erc20: SFRX_ETH,
  targetName: ethers.utils.formatBytes32String('USD'),
  rewardERC20: WETH,
  priceTimeout: ORACLE_TIMEOUT,
  chainlinkFeed: ETH_USD_PRICE_FEED,
  oracleTimeout: ORACLE_TIMEOUT,
  oracleError: ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
}

export const deployCollateral = async (opts: CollateralOpts = {}): Promise<ICollateral> => {
  opts = { ...defaultRethCollateralOpts, ...opts }

  const SFraxEthCollateralFactory: ContractFactory = await ethers.getContractFactory('SFraxEthCollateral')

  const collateral = <ICollateral>await SFraxEthCollateralFactory.deploy(
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
    0,
    { gasLimit: 2000000000 }
  )
  await collateral.deployed()

  return collateral
}

const chainlinkDefaultAnswer = bn('1600e8')

type Fixture<T> = () => Promise<T>

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CollateralOpts = {}
): Fixture<SFrxEthCollateralFixtureContext> => {
  const collateralOpts = { ...defaultRethCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const chainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, chainlinkDefaultAnswer)
    )
    collateralOpts.chainlinkFeed = chainlinkFeed.address

    const frxEth = (await ethers.getContractAt('ERC20Mock', FRX_ETH)) as ERC20Mock
    const sfrxEth = (await ethers.getContractAt('IsfrxEth', SFRX_ETH)) as IsfrxEth
    const rewardToken = (await ethers.getContractAt('ERC20Mock', ZERO_ADDRESS)) as ERC20Mock
    const collateral = await deployCollateral(collateralOpts)
    const tokDecimals = await sfrxEth.decimals()

    return {
      alice,
      collateral,
      chainlinkFeed,
      frxEth,
      sfrxEth,
      tok: sfrxEth,
      rewardToken,
      tokDecimals,
    }
  }

  return makeCollateralFixtureContext
}

// const deployCollateralCometMockContext = async (
//   opts: CometCollateralOpts = {}
// ): Promise<SFrxEthCollateralFixtureContextMockComet> => {
//   const collateralOpts = { ...defaultCometCollateralOpts, ...opts }

//   const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
//     await ethers.getContractFactory('MockV3Aggregator')
//   )
//   const chainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(6, bn('1e6'))
//   collateralOpts.chainlinkFeed = chainlinkFeed.address

//   const CometFactory = <CometMock__factory>await ethers.getContractFactory('CometMock')
//   const cusdcV3 = <CometMock>await CometFactory.deploy(bn('5e15'), bn('1e15'), CUSDC_V3)

//   const CusdcV3WrapperFactory = <CusdcV3Wrapper__factory>(
//     await ethers.getContractFactory('CusdcV3Wrapper')
//   )
//   const wcusdcV3 = <ICusdcV3Wrapper>(
//     await CusdcV3WrapperFactory.deploy(cusdcV3.address, REWARDS, COMP)
//   )
//   const CusdcV3WrapperMockFactory = <CusdcV3WrapperMock__factory>(
//     await ethers.getContractFactory('CusdcV3WrapperMock')
//   )
//   const wcusdcV3Mock = await (<ICusdcV3WrapperMock>(
//     await CusdcV3WrapperMockFactory.deploy(wcusdcV3.address)
//   ))

//   const realMock = (await ethers.getContractAt(
//     'ICusdcV3WrapperMock',
//     wcusdcV3Mock.address
//   )) as ICusdcV3WrapperMock
//   collateralOpts.erc20 = wcusdcV3.address
//   collateralOpts.erc20 = realMock.address
//   const usdc = <ERC20Mock>await ethers.getContractAt('ERC20Mock', USDC)
//   const collateral = await deployCollateral(collateralOpts)

//   const rewardToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP)
//   const tokDecimals = await wcusdcV3.decimals()

//   return {
//     collateral,
//     chainlinkFeed,
//     cusdcV3,
//     wcusdcV3: <ICusdcV3WrapperMock>wcusdcV3Mock,
//     wcusdcV3Mock,
//     usdc,
//     tok: wcusdcV3,
//     rewardToken,
//     tokDecimals,
//   }
// }

/*
  Define helper functions
*/

const mintCollateralTo: MintCollateralFunc<SFrxEthCollateralFixtureContext> = async (
  ctx: SFrxEthCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintsfrxETH(user, amount, recipient)
}

const rocketBalanceKey = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('network.balance.total'))

// prettier-ignore
const reduceRefPerTok = async (
  ctx: SFrxEthCollateralFixtureContext,
  pctDecrease: BigNumberish | undefined
) => {
  const currentBal = await ctx.frxEth.balanceOf(ctx.sfrxEth.address)
  const subBal = currentBal.sub(currentBal.mul(pctDecrease!).div(100))
  await whileImpersonating(SFRX_ETH, async (sfrxEth) => {
    await ctx.frxEth.connect(sfrxEth).transfer(ZERO_ADDRESS, subBal)
  })
}

// prettier-ignore
const increaseRefPerTok = async (
  ctx: SFrxEthCollateralFixtureContext,
  pctIncrease: BigNumberish | undefined
) => {
  const currentBal = await ctx.frxEth.balanceOf(ctx.sfrxEth.address)
  const addBal = currentBal.add(currentBal.mul(pctIncrease!).div(100))
  await whileImpersonating(FRX_ETH_MINTER, async (frxEthMinter) => {
    await ctx.frxEth.connect(frxEthMinter).mint(ctx.sfrxEth.address, addBal)
  })
  await ctx.sfrxEth.syncRewards()
  const rewardCycleLength = await ctx.sfrxEth.rewardsCycleLength()
  const currentTimestamp = await getLatestBlockTimestamp()
  await advanceBlocks(rewardCycleLength / 12)
  await setNextBlockTimestamp(currentTimestamp + rewardCycleLength)
}

/*
  Define collateral-specific tests
*/

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificConstructorTests = () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificStatusTests = () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const beforeEachRewardsTest = async () => {}

/*
  Run the test suite
*/

const opts = {
  deployCollateral,
  collateralSpecificConstructorTests,
  collateralSpecificStatusTests,
  beforeEachRewardsTest,
  makeCollateralFixtureContext,
  mintCollateralTo,
  reduceRefPerTok,
  increaseRefPerTok,
  itClaimsRewards: it.skip,
  itChecksTargetPerRefDefault: it.skip,
  resetFork,
  collateralName: 'RocketPoolETH',
  chainlinkDefaultAnswer,
}

collateralTests(opts)
