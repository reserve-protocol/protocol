import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  ERC20Mock,
  IBToken,
  IIncentivesController,
  ILendingPool,
  IStaticBTokenLM,
  IWETH,
  StaticBTokenLM,
  StaticBTokenLM__factory,
} from '../../../../typechain'
import { BigNumber, providers, utils } from 'ethers'
import { makeStaticBendWeth, resetFork } from './helpers'
import hre, { ethers } from 'hardhat'
import { BEND, BEND_WETH, INCENTIVES_CONTROLLER, LENDPOOL, WETH } from './constants'
import { expect } from 'chai'
import { evmRevert, evmSnapshot, waitForTx } from '../../../integration/utils'
import { MAX_UINT256, ZERO_ADDRESS } from '#/common/constants'
import { networkConfig } from '#/common/configuration'

const DEFAULT_GAS_LIMIT = 10000000
const DEFAULT_GAS_PRICE = utils.parseUnits('100', 'gwei')

const defaultTxParams = { gasLimit: DEFAULT_GAS_LIMIT, gasPrice: DEFAULT_GAS_PRICE }

const LM_ERRORS = {
  INVALID_OWNER: '1',
  INVALID_EXPIRATION: '2',
  INVALID_SIGNATURE: '3',
  INVALID_DEPOSITOR: '4',
  INVALID_RECIPIENT: '5',
  INVALID_CLAIMER: '6',
  ONLY_ONE_AMOUNT_FORMAT_ALLOWED: '7',
  ONLY_PROXY_MAY_CALL: '8',
}

type tBalancesInvolved = {
  staticBendWethBendWethBalance: BigNumber
  staticBendWethBendBalance: BigNumber
  staticBendWethUnderlyingBalance: BigNumber
  staticBendWethScaledBalanceBendWeth: BigNumber
  staticBendWethTotalClaimableRewards: BigNumber
  userBendBalance: BigNumber
  userBendWethBalance: BigNumber
  userScaledBalanceBendWeth: BigNumber
  userUnderlyingBalance: BigNumber
  userStaticBendWethBalance: BigNumber
  userDynamicStaticBendWethBalance: BigNumber
  userPendingRewards: BigNumber
  user2BendBalance: BigNumber
  user2BendWethBalance: BigNumber
  user2ScaledBalanceBendWeth: BigNumber
  user2UnderlyingBalance: BigNumber
  user2StaticBendWethBalance: BigNumber
  user2DynamicStaticBendWethBalance: BigNumber
  user2PendingRewards: BigNumber
  currentRate: BigNumber
  staticBendWethSupply: BigNumber
}

type tContextParams = {
  staticBendWeth: StaticBTokenLM
  underlying: ERC20Mock
  bendWeth: IBToken
  bend: ERC20Mock
  user: string
  user2: string
  lendingPool: ILendingPool
}

const getContext = async ({
  staticBendWeth,
  underlying,
  bendWeth,
  bend,
  user,
  user2,
  lendingPool,
}: tContextParams): Promise<tBalancesInvolved> => ({
  staticBendWethBendWethBalance: await bendWeth.balanceOf(staticBendWeth.address),
  staticBendWethBendBalance: await bend.balanceOf(staticBendWeth.address),
  staticBendWethUnderlyingBalance: await underlying.balanceOf(staticBendWeth.address),
  staticBendWethScaledBalanceBendWeth: await bendWeth.scaledBalanceOf(staticBendWeth.address),
  staticBendWethTotalClaimableRewards: await staticBendWeth.getTotalClaimableRewards(),
  userStaticBendWethBalance: await staticBendWeth.balanceOf(user),
  userBendBalance: await bend.balanceOf(user),
  userBendWethBalance: await bendWeth.balanceOf(user),
  userScaledBalanceBendWeth: await bendWeth.scaledBalanceOf(user),
  userUnderlyingBalance: await underlying.balanceOf(user),
  userDynamicStaticBendWethBalance: await staticBendWeth.dynamicBalanceOf(user),
  userPendingRewards: await staticBendWeth.getClaimableRewards(user),
  user2BendBalance: await bend.balanceOf(user2),
  user2BendWethBalance: await bendWeth.balanceOf(user2),
  user2ScaledBalanceBendWeth: await bendWeth.scaledBalanceOf(user2),
  user2UnderlyingBalance: await underlying.balanceOf(user2),
  user2StaticBendWethBalance: await staticBendWeth.balanceOf(user2),
  user2DynamicStaticBendWethBalance: await staticBendWeth.dynamicBalanceOf(user2),
  user2PendingRewards: await staticBendWeth.getClaimableRewards(user2),
  currentRate: await lendingPool.getReserveNormalizedIncome(WETH),
  staticBendWethSupply: await staticBendWeth.totalSupply(),
})

describe('StaticBendWETH: BToken wrapper with static balances and liquidity mining', () => {
  let user1: SignerWithAddress
  let user2: SignerWithAddress
  let userSigner: providers.JsonRpcSigner
  let user2Signer: providers.JsonRpcSigner
  let lendingPool: ILendingPool
  let incentives: IIncentivesController
  let weth: IWETH
  let bendWeth: IBToken
  let bend: ERC20Mock
  let staticBendWeth: StaticBTokenLM

  let ctxtParams: tContextParams
  let snap: string

  before(async () => {
    await resetFork()
    ;[user1, user2] = await ethers.getSigners()

    userSigner = hre.ethers.provider.getSigner(await user1.getAddress())
    user2Signer = hre.ethers.provider.getSigner(await user2.getAddress())

    lendingPool = <ILendingPool>await ethers.getContractAt('ILendingPool', LENDPOOL, userSigner)
    incentives = <IIncentivesController>(
      await ethers.getContractAt('IIncentivesController', INCENTIVES_CONTROLLER, userSigner)
    )
    // TODO: use makeStaticBendWeth from helper
    weth = <IWETH>await ethers.getContractAt('IWETH', WETH, userSigner)
    bendWeth = <IBToken>await ethers.getContractAt('IBToken', BEND_WETH, userSigner)
    bend = <ERC20Mock>await ethers.getContractAt('ERC20Mock', BEND, userSigner)

    const staticBTokenFactory = <StaticBTokenLM__factory>(
      await ethers.getContractFactory('StaticBTokenLM')
    )
    staticBendWeth = <StaticBTokenLM>(
      await staticBTokenFactory.deploy(LENDPOOL, bendWeth.address, 'Static Bend WETH', 'sBendWETH')
    )

    expect(await staticBendWeth.getIncentivesController()).to.equal(INCENTIVES_CONTROLLER)
    expect(await staticBendWeth.REWARD_TOKEN()).to.equal(BEND)

    ctxtParams = {
      staticBendWeth,
      underlying: <ERC20Mock>(<unknown>weth),
      bendWeth,
      bend,
      user: userSigner._address,
      user2: user2Signer._address,
      lendingPool,
    }
    snap = await evmSnapshot()
  })

  beforeEach(async () => {
    await evmRevert(snap)
    snap = await evmSnapshot()
  })

  after(async () => {
    await evmRevert(snap)
  })

  it('Deposit WETH on staticBendWeth, then withdraw whole balance in underlying', async () => {
    const amountToDeposit = utils.parseEther('5')
    const amountToWithdraw = MAX_UINT256

    // Just preparation
    await waitForTx(await weth.deposit({ value: amountToDeposit }))
    await waitForTx(await weth.approve(staticBendWeth.address, amountToDeposit, defaultTxParams))

    const ctxtInitial = await getContext(ctxtParams)

    await expect(
      staticBendWeth.deposit(ZERO_ADDRESS, amountToDeposit, 0, true, defaultTxParams)
    ).to.be.revertedWith(LM_ERRORS.INVALID_RECIPIENT)

    // Depositing
    await waitForTx(
      await staticBendWeth.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
    )

    const ctxtAfterDeposit = await getContext(ctxtParams)

    await expect(
      staticBendWeth.withdraw(ZERO_ADDRESS, amountToWithdraw, true, defaultTxParams)
    ).to.be.revertedWith(LM_ERRORS.INVALID_RECIPIENT)

    // Withdrawing all
    await waitForTx(
      await staticBendWeth.withdraw(userSigner._address, amountToWithdraw, true, defaultTxParams)
    )

    const ctxtAfterWithdrawal = await getContext(ctxtParams)

    // Claiming the rewards
    await waitForTx(
      await staticBendWeth.connect(userSigner).claimRewards(userSigner._address, false)
    )

    const ctxtAfterClaimNoForce = await getContext(ctxtParams)

    await waitForTx(
      await staticBendWeth.connect(userSigner).claimRewards(userSigner._address, true)
    )

    const ctxtAfterClaimForce = await getContext(ctxtParams)

    // Check that scaled BendWeth balance is equal to the staticBendWeth supply at every stage.
    expect(ctxtInitial.staticBendWethScaledBalanceBendWeth).to.be.eq(
      ctxtInitial.staticBendWethSupply
    )
    expect(ctxtAfterDeposit.staticBendWethScaledBalanceBendWeth).to.be.eq(
      ctxtAfterDeposit.staticBendWethSupply
    )
    expect(ctxtAfterWithdrawal.staticBendWethScaledBalanceBendWeth).to.be.eq(
      ctxtAfterWithdrawal.staticBendWethSupply
    )
    expect(ctxtAfterClaimNoForce.staticBendWethScaledBalanceBendWeth).to.be.eq(
      ctxtAfterClaimNoForce.staticBendWethSupply
    )

    expect(ctxtAfterDeposit.staticBendWethBendWethBalance).to.be.eq(
      ctxtInitial.staticBendWethBendWethBalance.add(amountToDeposit)
    )
    expect(ctxtAfterDeposit.userUnderlyingBalance).to.be.eq(
      ctxtInitial.userUnderlyingBalance.sub(amountToDeposit)
    )
    expect(ctxtAfterDeposit.userDynamicStaticBendWethBalance).to.be.eq(
      ctxtInitial.userDynamicStaticBendWethBalance.add(amountToDeposit)
    )
    expect(ctxtAfterDeposit.userDynamicStaticBendWethBalance).to.be.eq(
      ctxtAfterDeposit.staticBendWethBendWethBalance
    )
    expect(ctxtAfterDeposit.staticBendWethUnderlyingBalance).to.be.eq(
      ctxtInitial.staticBendWethUnderlyingBalance
    )
    expect(ctxtAfterDeposit.userBendWethBalance).to.be.eq(ctxtInitial.userBendWethBalance)
    expect(ctxtAfterDeposit.userBendBalance).to.be.eq(0)
    expect(ctxtAfterDeposit.staticBendWethBendBalance).to.be.eq(0)

    expect(ctxtAfterWithdrawal.userStaticBendWethBalance).to.be.eq(0)
    expect(ctxtAfterWithdrawal.staticBendWethBendWethBalance).to.be.eq(0)
    expect(ctxtAfterWithdrawal.staticBendWethSupply).to.be.eq(0)
    expect(ctxtAfterWithdrawal.staticBendWethUnderlyingBalance).to.be.eq(0)
    expect(ctxtAfterWithdrawal.staticBendWethBendBalance).to.be.eq(0)

    // Check with possible rounding error. Ahhh, it is because we have not claimed the shit after withdraw
    expect(ctxtAfterWithdrawal.staticBendWethTotalClaimableRewards).to.be.gte(
      ctxtAfterWithdrawal.userPendingRewards
    )

    expect(ctxtAfterWithdrawal.staticBendWethTotalClaimableRewards).to.be.lte(
      ctxtAfterWithdrawal.userPendingRewards.add(1)
    )
    expect(ctxtAfterWithdrawal.userBendBalance).to.be.eq(0)

    expect(ctxtAfterClaimNoForce.userBendBalance).to.be.eq(0)
    expect(ctxtAfterClaimNoForce.staticBendWethBendBalance).to.be.eq(0)

    expect(ctxtAfterClaimForce.userBendBalance).to.be.eq(ctxtAfterClaimNoForce.userPendingRewards)
    expect(ctxtAfterClaimForce.staticBendWethBendBalance).to.be.eq(
      ctxtAfterClaimNoForce.staticBendWethTotalClaimableRewards.sub(
        ctxtAfterClaimNoForce.userPendingRewards
      )
    )
  })
})
