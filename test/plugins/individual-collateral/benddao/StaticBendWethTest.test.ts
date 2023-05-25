import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  ERC20Mock,
  IBToken,
  ILendPool,
  IWETH,
  StaticBTokenLM,
  StaticBTokenLM__factory,
} from '../../../../typechain'
import { BigNumber, Signer, providers, utils } from 'ethers'
import { resetFork } from './helpers'
import hre, { ethers } from 'hardhat'
import { BEND, BEND_WETH, INCENTIVES_CONTROLLER, LENDPOOL, WETH } from './constants'
import { expect } from 'chai'
import { evmRevert, evmSnapshot, waitForTx } from '../../../integration/utils'
import { MAX_UINT256, ZERO_ADDRESS } from '../../../../common/constants'
import { rayMul } from '../../../integration/ray-math'
import bnjs from 'bignumber.js'
import { advanceTime } from '../../../utils/time'
import { formatEther } from 'ethers/lib/utils'

const DUST = 100

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
  lendPool: ILendPool
}

const getContext = async ({
  staticBendWeth,
  underlying,
  bendWeth,
  bend,
  user,
  user2,
  lendPool,
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
  currentRate: await lendPool.getReserveNormalizedIncome(WETH),
  staticBendWethSupply: await staticBendWeth.totalSupply(),
})

const getUserData = async (
  _users: Signer[],
  _debug = false,
  staticBendWeth: StaticBTokenLM,
  bend: ERC20Mock
) => {
  const usersData: {
    pendingRewards: BigNumber
    bendBalance: BigNumber
    staticBalance: BigNumber
  }[] = []
  if (_debug) {
    console.log(`Printing user data:`)
  }
  for (let i = 0; i < _users.length; i++) {
    const userAddress = await _users[i].getAddress()
    usersData.push({
      pendingRewards: await staticBendWeth.getClaimableRewards(userAddress),
      bendBalance: await bend.balanceOf(userAddress),
      staticBalance: await staticBendWeth.balanceOf(userAddress),
    })
    if (_debug) {
      console.log(
        `\tUser ${i} pendingRewards: ${formatEther(
          usersData[i].pendingRewards
        )}, bend balance: ${formatEther(usersData[i].bendBalance)}, static bal: ${formatEther(
          usersData[i].staticBalance
        )} `
      )
    }
  }
  return usersData
}

describe('StaticBendWETH: BToken wrapper with static balances and liquidity mining', () => {
  let user1: SignerWithAddress
  let user2: SignerWithAddress
  let userSigner: providers.JsonRpcSigner
  let user2Signer: providers.JsonRpcSigner
  let lendPool: ILendPool
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

    lendPool = <ILendPool>await ethers.getContractAt('ILendPool', LENDPOOL, userSigner)

    weth = <IWETH>await ethers.getContractAt('IWETH', WETH, userSigner)
    bendWeth = <IBToken>await ethers.getContractAt('IBToken', BEND_WETH, userSigner)
    bend = <ERC20Mock>await ethers.getContractAt('ERC20Mock', BEND, userSigner)

    const staticBTokenFactory = <StaticBTokenLM__factory>(
      await ethers.getContractFactory('StaticBTokenLM')
    )
    staticBendWeth = <StaticBTokenLM>(
      await staticBTokenFactory.deploy(
        LENDPOOL,
        bendWeth.address,
        'Static Bend interest bearing WETH',
        'staticBendWETH'
      )
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
      lendPool,
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

  it('Deposit WETH on staticBendWETH and then withdraw some balance in underlying', async () => {
    const amountToDeposit = utils.parseEther('5')
    const amountToWithdraw = utils.parseEther('2.5')

    // Preparation
    await waitForTx(await weth.deposit({ value: amountToDeposit }))
    await waitForTx(await weth.approve(staticBendWeth.address, amountToDeposit, defaultTxParams))

    const ctxtInitial = await getContext(ctxtParams)

    // Deposit
    await waitForTx(
      await staticBendWeth.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
    )

    const ctxtAfterDeposit = await getContext(ctxtParams)

    // Withdraw
    await waitForTx(
      await staticBendWeth.withdraw(userSigner._address, amountToWithdraw, true, defaultTxParams)
    )
    const ctxtAfterWithdrawal = await getContext(ctxtParams)

    // Claim
    await waitForTx(
      await staticBendWeth.connect(userSigner).claimRewards(userSigner._address, false)
    )
    const ctxtAfterClaim = await getContext(ctxtParams)

    await waitForTx(await staticBendWeth.collectAndUpdateRewards())
    const ctxtAfterUpdate = await getContext(ctxtParams)

    await waitForTx(
      await staticBendWeth.connect(userSigner).claimRewards(userSigner._address, false)
    )
    const ctxtAfterClaim2 = await getContext(ctxtParams)

    expect(ctxtInitial.userStaticBendWethBalance).to.be.eq(0)
    expect(ctxtInitial.staticBendWethSupply).to.be.eq(0)
    expect(ctxtInitial.staticBendWethUnderlyingBalance).to.be.eq(0)
    expect(ctxtAfterDeposit.userDynamicStaticBendWethBalance).to.be.eq(
      ctxtAfterDeposit.staticBendWethBendWethBalance
    )
    expect(ctxtAfterDeposit.userStaticBendWethBalance).to.be.eq(
      ctxtAfterDeposit.staticBendWethSupply
    )
    expect(ctxtAfterDeposit.staticBendWethBendWethBalance).to.be.eq(
      ctxtAfterDeposit.userDynamicStaticBendWethBalance
    )
    expect(ctxtAfterDeposit.staticBendWethBendWethBalance).to.be.eq(amountToDeposit)

    expect(ctxtAfterWithdrawal.userDynamicStaticBendWethBalance).to.be.eq(
      BigNumber.from(
        rayMul(
          new bnjs(ctxtAfterDeposit.userStaticBendWethBalance.sub(amountToWithdraw).toString()),
          new bnjs(ctxtAfterWithdrawal.currentRate.toString())
        ).toString()
      )
    )
    expect(ctxtAfterWithdrawal.userStaticBendWethBalance).to.be.eq(
      ctxtAfterDeposit.userStaticBendWethBalance.sub(amountToWithdraw)
    )

    expect(ctxtAfterUpdate.userBendBalance).to.be.eq(0)
    expect(ctxtAfterClaim2.userBendBalance).to.be.eq(ctxtAfterUpdate.userPendingRewards)
    expect(ctxtAfterClaim2.userPendingRewards).to.be.gt(0)

    // Check that rewards are always covered
    expect(ctxtInitial.staticBendWethTotalClaimableRewards).to.be.gte(
      ctxtInitial.userPendingRewards
    )
    expect(ctxtAfterDeposit.staticBendWethTotalClaimableRewards).to.be.gte(
      ctxtAfterDeposit.userPendingRewards
    )
    expect(ctxtAfterWithdrawal.staticBendWethTotalClaimableRewards).to.be.gte(
      ctxtAfterWithdrawal.userPendingRewards
    )
    expect(ctxtAfterClaim.staticBendWethTotalClaimableRewards).to.be.gte(
      ctxtAfterClaim.userPendingRewards
    )
    expect(ctxtAfterUpdate.staticBendWethTotalClaimableRewards).to.be.gte(
      ctxtAfterUpdate.userPendingRewards
    )
    expect(ctxtAfterClaim2.staticBendWethTotalClaimableRewards).to.be.gte(
      ctxtAfterClaim2.userPendingRewards
    )
  })

  it('Deposit WETH on staticBendWETH to recipient and then withdraw some balance in underlying', async () => {
    const amountToDeposit = utils.parseEther('5')
    const amountToWithdraw = utils.parseEther('2.5')

    // Preparation
    await waitForTx(await weth.deposit({ value: amountToDeposit }))
    await waitForTx(await weth.approve(staticBendWeth.address, amountToDeposit, defaultTxParams))

    const ctxtInitial = await getContext(ctxtParams)

    // Deposit to recipient user2
    await waitForTx(
      await staticBendWeth.deposit(user2Signer._address, amountToDeposit, 0, true, defaultTxParams)
    )

    const ctxtAfterDeposit = await getContext(ctxtParams)

    // Withdraw
    await waitForTx(
      await staticBendWeth
        .connect(user2Signer)
        .withdraw(user2Signer._address, amountToWithdraw, true, defaultTxParams)
    )
    const ctxtAfterWithdrawal = await getContext(ctxtParams)

    // Claim
    await waitForTx(
      await staticBendWeth.connect(user2Signer).claimRewards(user2Signer._address, false)
    )
    const ctxtAfterClaim = await getContext(ctxtParams)

    await waitForTx(await staticBendWeth.collectAndUpdateRewards())
    const ctxtAfterUpdate = await getContext(ctxtParams)

    await waitForTx(
      await staticBendWeth.connect(user2Signer).claimRewards(user2Signer._address, false)
    )
    const ctxtAfterClaim2 = await getContext(ctxtParams)

    expect(ctxtInitial.user2StaticBendWethBalance).to.be.eq(0)
    expect(ctxtInitial.staticBendWethSupply).to.be.eq(0)
    expect(ctxtInitial.staticBendWethUnderlyingBalance).to.be.eq(0)
    expect(ctxtAfterDeposit.user2DynamicStaticBendWethBalance).to.be.eq(
      ctxtAfterDeposit.staticBendWethBendWethBalance
    )
    expect(ctxtAfterDeposit.user2StaticBendWethBalance).to.be.eq(
      ctxtAfterDeposit.staticBendWethSupply
    )
    expect(ctxtAfterDeposit.staticBendWethBendWethBalance).to.be.eq(
      ctxtAfterDeposit.user2DynamicStaticBendWethBalance
    )
    expect(ctxtAfterDeposit.staticBendWethBendWethBalance).to.be.eq(amountToDeposit)

    expect(ctxtAfterWithdrawal.user2DynamicStaticBendWethBalance).to.be.eq(
      BigNumber.from(
        rayMul(
          new bnjs(ctxtAfterDeposit.user2StaticBendWethBalance.sub(amountToWithdraw).toString()),
          new bnjs(ctxtAfterWithdrawal.currentRate.toString())
        ).toString()
      )
    )
    expect(ctxtAfterWithdrawal.user2StaticBendWethBalance).to.be.eq(
      ctxtAfterDeposit.user2StaticBendWethBalance.sub(amountToWithdraw)
    )

    expect(ctxtAfterUpdate.user2BendBalance).to.be.eq(0)
    expect(ctxtAfterClaim2.user2BendBalance).to.be.eq(ctxtAfterUpdate.user2PendingRewards)
    expect(ctxtAfterClaim2.user2PendingRewards).to.be.gt(0)

    // Check that rewards are always covered
    expect(ctxtInitial.staticBendWethTotalClaimableRewards).to.be.gte(
      ctxtInitial.user2PendingRewards
    )
    expect(ctxtAfterDeposit.staticBendWethTotalClaimableRewards).to.be.gte(
      ctxtAfterDeposit.user2PendingRewards
    )
    expect(ctxtAfterWithdrawal.staticBendWethTotalClaimableRewards).to.be.gte(
      ctxtAfterWithdrawal.user2PendingRewards
    )
    expect(ctxtAfterClaim.staticBendWethTotalClaimableRewards).to.be.gte(
      ctxtAfterClaim.user2PendingRewards
    )
    expect(ctxtAfterUpdate.staticBendWethTotalClaimableRewards).to.be.gte(
      ctxtAfterUpdate.user2PendingRewards
    )
    expect(ctxtAfterClaim2.staticBendWethTotalClaimableRewards).to.be.gte(
      ctxtAfterClaim2.user2PendingRewards
    )
  })

  it('Deposit WETH on staticBendWETH and then withdraw all the balance in bendWETH', async () => {
    const amountToDeposit = utils.parseEther('5')
    const amountToWithdraw = MAX_UINT256

    // Preparation
    await waitForTx(await weth.deposit({ value: amountToDeposit }))
    await waitForTx(await weth.approve(staticBendWeth.address, amountToDeposit, defaultTxParams))

    const ctxtInitial = await getContext(ctxtParams)

    // Deposit
    await waitForTx(
      await staticBendWeth.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
    )

    const ctxtAfterDeposit = await getContext(ctxtParams)

    // Withdraw
    await waitForTx(
      await staticBendWeth.withdraw(userSigner._address, amountToWithdraw, false, defaultTxParams)
    )

    const ctxtAfterWithdrawal = await getContext(ctxtParams)

    expect(ctxtInitial.staticBendWethSupply).to.be.eq(0)
    expect(ctxtInitial.userBendWethBalance).to.be.eq(0)
    expect(ctxtAfterDeposit.staticBendWethBendWethBalance).to.be.eq(
      ctxtAfterDeposit.userDynamicStaticBendWethBalance
    )
    expect(ctxtAfterDeposit.userStaticBendWethBalance).to.be.eq(
      ctxtAfterDeposit.staticBendWethSupply
    )
    expect(ctxtAfterDeposit.userDynamicStaticBendWethBalance).to.be.eq(amountToDeposit)
    expect(ctxtAfterWithdrawal.userBendWethBalance).to.be.eq(
      rayMul(
        ctxtAfterDeposit.userStaticBendWethBalance.toString(),
        ctxtAfterWithdrawal.currentRate.toString()
      ).toString()
    )
    expect(ctxtAfterWithdrawal.userStaticBendWethBalance).to.be.eq(0)
  })

  it('Deposit bendWETH on staticBendWETH and then withdraw some balance in bendWETH', async () => {
    const amountToDeposit = utils.parseEther('5')
    const amountToWithdraw = utils.parseEther('2.5')

    // Preparation
    await waitForTx(await weth.deposit({ value: amountToDeposit }))
    await waitForTx(await weth.approve(lendPool.address, amountToDeposit, defaultTxParams))
    await waitForTx(
      await lendPool.deposit(weth.address, amountToDeposit, userSigner._address, 0, defaultTxParams)
    )
    const ctxtInitial = await getContext(ctxtParams)
    await waitForTx(
      await bendWeth.approve(staticBendWeth.address, amountToDeposit, defaultTxParams)
    )

    // Deposit
    await waitForTx(
      await staticBendWeth.deposit(userSigner._address, amountToDeposit, 0, false, defaultTxParams)
    )

    const ctxtAfterDeposit = await getContext(ctxtParams)

    // Withdraw
    await waitForTx(
      await staticBendWeth.withdraw(userSigner._address, amountToWithdraw, false, defaultTxParams)
    )

    const ctxtAfterWithdrawal = await getContext(ctxtParams)

    expect(ctxtInitial.userStaticBendWethBalance).to.be.eq(0)
    expect(ctxtInitial.userBendWethBalance).to.eq(amountToDeposit)
    expect(ctxtInitial.staticBendWethSupply).to.be.eq(0)
    expect(ctxtInitial.staticBendWethUnderlyingBalance).to.be.eq(0)

    expect(ctxtAfterDeposit.userDynamicStaticBendWethBalance).to.be.eq(
      ctxtAfterDeposit.staticBendWethBendWethBalance
    )
    expect(ctxtAfterDeposit.userStaticBendWethBalance).to.be.eq(
      ctxtAfterDeposit.staticBendWethSupply
    )
    expect(ctxtAfterDeposit.staticBendWethBendWethBalance).to.be.eq(amountToDeposit)

    expect(ctxtAfterWithdrawal.userStaticBendWethBalance).to.be.eq(
      ctxtAfterDeposit.userStaticBendWethBalance.sub(amountToWithdraw)
    )

    expect(ctxtAfterWithdrawal.userDynamicStaticBendWethBalance).to.be.eq(
      BigNumber.from(
        rayMul(
          new bnjs(ctxtAfterDeposit.userStaticBendWethBalance.sub(amountToWithdraw).toString()),
          new bnjs(ctxtAfterWithdrawal.currentRate.toString())
        ).toString()
      )
    )

    expect(ctxtAfterWithdrawal.userBendWethBalance).to.be.eq(
      BigNumber.from(
        rayMul(
          new bnjs(ctxtAfterDeposit.userScaledBalanceBendWeth.add(amountToWithdraw).toString()),
          new bnjs(ctxtAfterWithdrawal.currentRate.toString())
        ).toString()
      )
    )
  })

  it('Deposit bendWETH on staticBendWETH to recipient and then withdraw all to recipient in bendWETH', async () => {
    const amountToDeposit = utils.parseEther('5')
    const amountToWithdraw = MAX_UINT256

    // Preparation
    await waitForTx(await weth.deposit({ value: amountToDeposit }))
    await waitForTx(await weth.approve(lendPool.address, amountToDeposit, defaultTxParams))
    await waitForTx(
      await lendPool.deposit(weth.address, amountToDeposit, userSigner._address, 0, defaultTxParams)
    )
    const ctxtInitial = await getContext(ctxtParams)
    await waitForTx(
      await bendWeth.approve(staticBendWeth.address, amountToDeposit, defaultTxParams)
    )

    // Deposit to recipient user2
    await waitForTx(
      await staticBendWeth.deposit(user2Signer._address, amountToDeposit, 0, false, defaultTxParams)
    )

    const ctxtAfterDeposit = await getContext(ctxtParams)

    // Withdraw back to user1
    await waitForTx(
      await staticBendWeth
        .connect(user2Signer)
        .withdraw(userSigner._address, amountToWithdraw, false, defaultTxParams)
    )

    const ctxtAfterWithdrawal = await getContext(ctxtParams)

    expect(ctxtInitial.userStaticBendWethBalance).to.be.eq(0)
    expect(ctxtInitial.userBendWethBalance).to.eq(amountToDeposit)
    expect(ctxtInitial.staticBendWethSupply).to.be.eq(0)
    expect(ctxtInitial.staticBendWethUnderlyingBalance).to.be.eq(0)

    expect(ctxtAfterDeposit.user2DynamicStaticBendWethBalance).to.be.eq(
      ctxtAfterDeposit.staticBendWethBendWethBalance
    )
    expect(ctxtAfterDeposit.user2StaticBendWethBalance).to.be.eq(
      ctxtAfterDeposit.staticBendWethSupply
    )
    expect(ctxtAfterDeposit.staticBendWethBendWethBalance).to.be.eq(amountToDeposit)

    expect(ctxtAfterDeposit.user2DynamicStaticBendWethBalance).to.be.eq(amountToDeposit)

    const user2OnWithdrawal = rayMul(
      ctxtAfterDeposit.user2StaticBendWethBalance.toString(),
      ctxtAfterWithdrawal.currentRate.toString()
    )
    // User1 had bendWETH crumbles after deposit
    const userOnWithdrawal = rayMul(
      ctxtAfterDeposit.userScaledBalanceBendWeth.toString(),
      ctxtAfterWithdrawal.currentRate.toString()
    )

    expect(ctxtAfterWithdrawal.userBendWethBalance).to.be.eq(
      user2OnWithdrawal.plus(userOnWithdrawal).toString()
    )
    expect(ctxtAfterWithdrawal.userStaticBendWethBalance).to.be.eq(0)
    expect(ctxtAfterWithdrawal.user2StaticBendWethBalance).to.be.eq(0)
  })

  it('Withdraw using withdrawDynamicAmount()', async () => {
    const amountToDeposit = utils.parseEther('5')
    const amountToWithdraw = utils.parseEther('1')

    // Preparation
    await waitForTx(await weth.deposit({ value: amountToDeposit }))
    await waitForTx(await weth.approve(staticBendWeth.address, amountToDeposit, defaultTxParams))

    // Deposit
    await waitForTx(
      await staticBendWeth.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
    )

    const ctxtBeforeWithdrawal = await getContext(ctxtParams)

    // Withdraw dynamic amount
    await waitForTx(
      await staticBendWeth.withdrawDynamicAmount(
        userSigner._address,
        amountToWithdraw,
        false,
        defaultTxParams
      )
    )

    const ctxtAfterWithdrawal = await getContext(ctxtParams)

    expect(ctxtBeforeWithdrawal.userBendWethBalance).to.be.eq(0)
    expect(ctxtBeforeWithdrawal.staticBendWethBendWethBalance).to.be.closeTo(amountToDeposit, 2)
    expect(ctxtAfterWithdrawal.userBendWethBalance).to.be.closeTo(amountToWithdraw, 2)
    expect(ctxtAfterWithdrawal.userDynamicStaticBendWethBalance).to.be.closeTo(
      BigNumber.from(
        rayMul(
          new bnjs(ctxtBeforeWithdrawal.userStaticBendWethBalance.toString()),
          new bnjs(ctxtAfterWithdrawal.currentRate.toString())
        ).toString()
      ).sub(amountToWithdraw),
      2
    )

    expect(ctxtAfterWithdrawal.userBendBalance).to.be.eq(0)
  })

  it('Deposit WETH on staticBendWETH, then transfer and withdraw of the whole balance in underlying, finally claim', async () => {
    const amountToDeposit = utils.parseEther('5')
    const amountToWithdraw = MAX_UINT256

    // Preparation
    await waitForTx(await weth.deposit({ value: amountToDeposit }))
    await waitForTx(await weth.approve(staticBendWeth.address, amountToDeposit, defaultTxParams))

    const ctxtInitial = await getContext(ctxtParams)

    // Deposit
    await waitForTx(
      await staticBendWeth.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
    )

    const ctxtAfterDeposit = await getContext(ctxtParams)
    // Transfer staticBendWeths to other user
    await waitForTx(
      await staticBendWeth.transfer(
        user2Signer._address,
        ctxtAfterDeposit.userStaticBendWethBalance
      )
    )

    const ctxtAfterTransfer = await getContext(ctxtParams)

    // Withdraw
    await waitForTx(
      await staticBendWeth
        .connect(user2Signer)
        .withdraw(user2Signer._address, amountToWithdraw, true, defaultTxParams)
    )

    const ctxtAfterWithdrawal = await getContext(ctxtParams)

    // Claim
    await waitForTx(
      await staticBendWeth.connect(user2Signer).claimRewards(user2Signer._address, true)
    )
    const ctxtAfterClaim = await getContext(ctxtParams)

    // Checks
    expect(ctxtAfterDeposit.staticBendWethBendWethBalance).to.be.eq(
      ctxtInitial.staticBendWethBendWethBalance.add(amountToDeposit)
    )
    expect(ctxtAfterDeposit.userUnderlyingBalance).to.be.eq(
      ctxtInitial.userUnderlyingBalance.sub(amountToDeposit)
    )
    expect(ctxtAfterTransfer.user2StaticBendWethBalance).to.be.eq(
      ctxtAfterDeposit.userStaticBendWethBalance
    )
    expect(ctxtAfterTransfer.userStaticBendWethBalance).to.be.eq(0)
    expect(ctxtAfterTransfer.userPendingRewards).to.be.eq(0)
    expect(ctxtAfterTransfer.user2PendingRewards).to.be.gt(0)
    expect(ctxtAfterWithdrawal.staticBendWethSupply).to.be.eq(0)
    expect(ctxtAfterWithdrawal.staticBendWethBendWethBalance).to.be.eq(0)
    expect(ctxtAfterWithdrawal.userPendingRewards).to.be.eq(0)
    expect(ctxtAfterWithdrawal.staticBendWethTotalClaimableRewards).to.be.gte(
      ctxtAfterWithdrawal.user2PendingRewards
    )

    expect(ctxtAfterClaim.userBendBalance).to.be.eq(0)
    expect(ctxtAfterClaim.user2BendBalance).to.be.eq(ctxtAfterWithdrawal.user2PendingRewards)
    expect(ctxtAfterClaim.staticBendWethBendBalance).to.be.eq(
      ctxtAfterWithdrawal.staticBendWethTotalClaimableRewards.sub(
        ctxtAfterWithdrawal.user2PendingRewards
      )
    )
    // Expect dust to be left in the contract
    expect(ctxtAfterClaim.staticBendWethBendBalance).to.be.lt(5)
  })

  it('Deposit WETH on staticBendWETH, then transfer and withdraw of the whole balance in underlying, finally claimToSelf', async () => {
    const amountToDeposit = utils.parseEther('5')
    const amountToWithdraw = MAX_UINT256

    // Preparation
    await waitForTx(await weth.deposit({ value: amountToDeposit }))
    await waitForTx(await weth.approve(staticBendWeth.address, amountToDeposit, defaultTxParams))

    const ctxtInitial = await getContext(ctxtParams)

    // Deposit
    await waitForTx(
      await staticBendWeth.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
    )

    const ctxtAfterDeposit = await getContext(ctxtParams)
    // Transfer staticBendWeths to other user
    await waitForTx(
      await staticBendWeth.transfer(
        user2Signer._address,
        ctxtAfterDeposit.userStaticBendWethBalance
      )
    )

    const ctxtAfterTransfer = await getContext(ctxtParams)

    // Withdraw
    await waitForTx(
      await staticBendWeth
        .connect(user2Signer)
        .withdraw(user2Signer._address, amountToWithdraw, true, defaultTxParams)
    )

    const ctxtAfterWithdrawal = await getContext(ctxtParams)

    // Claim
    await waitForTx(await staticBendWeth.connect(user2Signer).claimRewardsToSelf(true))
    const ctxtAfterClaim = await getContext(ctxtParams)

    // Checks
    expect(ctxtAfterDeposit.staticBendWethBendWethBalance).to.be.eq(
      ctxtInitial.staticBendWethBendWethBalance.add(amountToDeposit)
    )
    expect(ctxtAfterDeposit.userUnderlyingBalance).to.be.eq(
      ctxtInitial.userUnderlyingBalance.sub(amountToDeposit)
    )
    expect(ctxtAfterTransfer.user2StaticBendWethBalance).to.be.eq(
      ctxtAfterDeposit.userStaticBendWethBalance
    )
    expect(ctxtAfterTransfer.userStaticBendWethBalance).to.be.eq(0)
    expect(ctxtAfterTransfer.userPendingRewards).to.be.eq(0)
    expect(ctxtAfterTransfer.user2PendingRewards).to.be.gt(0)
    expect(ctxtAfterWithdrawal.staticBendWethSupply).to.be.eq(0)
    expect(ctxtAfterWithdrawal.staticBendWethBendWethBalance).to.be.eq(0)
    expect(ctxtAfterWithdrawal.userPendingRewards).to.be.eq(0)
    expect(ctxtAfterWithdrawal.staticBendWethTotalClaimableRewards).to.be.gte(
      ctxtAfterWithdrawal.user2PendingRewards
    )

    expect(ctxtAfterClaim.userBendBalance).to.be.eq(0)
    expect(ctxtAfterClaim.user2BendBalance).to.be.eq(ctxtAfterWithdrawal.user2PendingRewards)
    expect(ctxtAfterClaim.staticBendWethBendBalance).to.be.eq(
      ctxtAfterWithdrawal.staticBendWethTotalClaimableRewards.sub(
        ctxtAfterWithdrawal.user2PendingRewards
      )
    )
    // Expect dust to be left in the contract
    expect(ctxtAfterClaim.staticBendWethBendBalance).to.be.lt(5)
  })

  it('Deposit WETH on staticBendWETH, then transfer and withdraw of the whole balance in underlying, finally claims to recipient', async () => {
    const amountToDeposit = utils.parseEther('5')
    const amountToWithdraw = MAX_UINT256

    // Preparation
    await waitForTx(await weth.deposit({ value: amountToDeposit }))
    await waitForTx(await weth.approve(staticBendWeth.address, amountToDeposit, defaultTxParams))

    const ctxtInitial = await getContext(ctxtParams)

    // Deposit
    await waitForTx(
      await staticBendWeth.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
    )

    const ctxtAfterDeposit = await getContext(ctxtParams)
    // Transfer staticBendWeths to other user
    await waitForTx(
      await staticBendWeth.transfer(
        user2Signer._address,
        ctxtAfterDeposit.userStaticBendWethBalance
      )
    )

    const ctxtAfterTransfer = await getContext(ctxtParams)

    // Withdraw
    await waitForTx(
      await staticBendWeth
        .connect(user2Signer)
        .withdraw(user2Signer._address, amountToWithdraw, true, defaultTxParams)
    )

    const ctxtAfterWithdrawal = await getContext(ctxtParams)

    // Claim to user1
    await waitForTx(
      await staticBendWeth.connect(user2Signer).claimRewards(userSigner._address, true)
    )
    const ctxtAfterClaim = await getContext(ctxtParams)

    // Checks
    expect(ctxtAfterDeposit.staticBendWethBendWethBalance).to.be.eq(
      ctxtInitial.staticBendWethBendWethBalance.add(amountToDeposit)
    )
    expect(ctxtAfterDeposit.userUnderlyingBalance).to.be.eq(
      ctxtInitial.userUnderlyingBalance.sub(amountToDeposit)
    )
    expect(ctxtAfterTransfer.user2StaticBendWethBalance).to.be.eq(
      ctxtAfterDeposit.userStaticBendWethBalance
    )
    expect(ctxtAfterTransfer.userStaticBendWethBalance).to.be.eq(0)
    expect(ctxtAfterTransfer.userPendingRewards).to.be.eq(0)
    expect(ctxtAfterTransfer.user2PendingRewards).to.be.gt(0)
    expect(ctxtAfterWithdrawal.staticBendWethSupply).to.be.eq(0)
    expect(ctxtAfterWithdrawal.staticBendWethBendWethBalance).to.be.eq(0)
    expect(ctxtAfterWithdrawal.userPendingRewards).to.be.eq(0)
    expect(ctxtAfterWithdrawal.staticBendWethTotalClaimableRewards).to.be.gte(
      ctxtAfterWithdrawal.user2PendingRewards
    )

    expect(ctxtAfterClaim.user2BendBalance).to.be.eq(0)
    expect(ctxtAfterClaim.userBendBalance).to.be.eq(ctxtAfterWithdrawal.user2PendingRewards)
    expect(ctxtAfterClaim.staticBendWethBendBalance).to.be.eq(
      ctxtAfterWithdrawal.staticBendWethTotalClaimableRewards.sub(
        ctxtAfterWithdrawal.user2PendingRewards
      )
    )
    // Expect dust to be left in the contract
    expect(ctxtAfterClaim.staticBendWethBendBalance).to.be.lt(5)
  })

  describe('Rewards - Small checks', () => {
    it('Rewards increase at deposit, update and withdraw and set to 0 at claim', async () => {
      const amountToDeposit = utils.parseEther('5')
      const amountToWithdraw = MAX_UINT256

      // Just preparation
      await waitForTx(await weth.deposit({ value: amountToDeposit.mul(2) }))
      await waitForTx(
        await weth.approve(staticBendWeth.address, amountToDeposit.mul(2), defaultTxParams)
      )

      // Depositing
      await waitForTx(
        await staticBendWeth.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
      )

      const pendingRewards1 = await staticBendWeth.getClaimableRewards(userSigner._address)

      // Depositing
      await waitForTx(
        await staticBendWeth.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
      )

      const pendingRewards2 = await staticBendWeth.getClaimableRewards(userSigner._address)

      await waitForTx(await staticBendWeth.collectAndUpdateRewards())

      const pendingRewards3 = await staticBendWeth.getClaimableRewards(userSigner._address)

      // Withdrawing all.
      await waitForTx(
        await staticBendWeth.withdraw(userSigner._address, amountToWithdraw, true, defaultTxParams)
      )

      const pendingRewards4 = await staticBendWeth.getClaimableRewards(userSigner._address)
      const totPendingRewards4 = await staticBendWeth.getTotalClaimableRewards()
      const claimedRewards4 = await bend.balanceOf(userSigner._address)
      const bendStatic4 = await bend.balanceOf(staticBendWeth.address)

      await waitForTx(await staticBendWeth.connect(userSigner).claimRewardsToSelf(false))

      const pendingRewards5 = await staticBendWeth.getClaimableRewards(userSigner._address)
      const totPendingRewards5 = await staticBendWeth.getTotalClaimableRewards()
      const claimedRewards5 = await bend.balanceOf(userSigner._address)
      const bendStatic5 = await bend.balanceOf(staticBendWeth.address)

      await waitForTx(await staticBendWeth.collectAndUpdateRewards())
      const pendingRewards6 = await staticBendWeth.getClaimableRewards(userSigner._address)

      // Checks
      expect(pendingRewards2).to.be.gt(pendingRewards1)
      expect(pendingRewards3).to.be.gt(pendingRewards2)
      expect(pendingRewards4).to.be.gt(pendingRewards3)
      expect(totPendingRewards4).to.be.gte(pendingRewards4)
      expect(pendingRewards5).to.be.eq(0) // User "sacrifice" excess rewards to save on gas-costs
      expect(pendingRewards6).to.be.eq(0)
      expect(claimedRewards4).to.be.eq(0)

      // Expect the user to have withdrawn everything.
      expect(claimedRewards5).to.be.eq(bendStatic4)
      expect(bendStatic5).to.be.eq(0)
      expect(totPendingRewards5).to.be.gt(0)
    })

    it('Check getters', async () => {
      const amountToDeposit = utils.parseEther('5')

      const accRewardsPerTokenPre = await staticBendWeth.getAccRewardsPerToken()
      const lifetimeRewardsClaimedPre = await staticBendWeth.getLifetimeRewardsClaimed()
      const lifetimeRewards = await staticBendWeth.getLifetimeRewards()
      const lastRewardBlock = await staticBendWeth.getLastRewardBlock()

      // Just preparation
      await waitForTx(await weth.deposit({ value: amountToDeposit.mul(2) }))
      await waitForTx(
        await weth.approve(staticBendWeth.address, amountToDeposit.mul(2), defaultTxParams)
      )

      // Depositing
      await waitForTx(
        await staticBendWeth.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
      )

      const staticBalance = await staticBendWeth.balanceOf(userSigner._address)
      const dynamicBalance = await staticBendWeth.dynamicBalanceOf(userSigner._address)

      const dynamicBalanceFromStatic = await staticBendWeth.staticToDynamicAmount(staticBalance)
      const staticBalanceFromDynamic = await staticBendWeth.dynamicToStaticAmount(dynamicBalance)

      expect(staticBalance).to.be.eq(staticBalanceFromDynamic)
      expect(dynamicBalance).to.be.eq(dynamicBalanceFromStatic)

      await staticBendWeth.collectAndUpdateRewards()

      expect(await staticBendWeth.getAccRewardsPerToken()).to.be.gt(accRewardsPerTokenPre)
      expect(await staticBendWeth.getLifetimeRewardsClaimed()).to.be.gt(lifetimeRewardsClaimedPre)
      expect(await staticBendWeth.getLifetimeRewards()).to.be.gt(lifetimeRewards)
      expect(await staticBendWeth.getLastRewardBlock()).to.be.gt(lastRewardBlock)
    })

    it('Multiple deposits in one block (Breaks if GasReport enabled)', async () => {
      const amountToDeposit = utils.parseEther('5')

      // Just preparation
      await waitForTx(await weth.deposit({ value: amountToDeposit.mul(2) }))
      await waitForTx(
        await weth.approve(staticBendWeth.address, amountToDeposit.mul(2), defaultTxParams)
      )

      await hre.network.provider.send('evm_setAutomine', [false])

      // Depositing
      const a = await staticBendWeth.deposit(
        userSigner._address,
        amountToDeposit,
        0,
        true,
        defaultTxParams
      )

      // Depositing
      const b = await staticBendWeth.deposit(
        userSigner._address,
        amountToDeposit,
        0,
        true,
        defaultTxParams
      )

      await hre.network.provider.send('evm_mine', [])

      const aReceipt = await hre.network.provider.send('eth_getTransactionReceipt', [a.hash])
      const bReceipt = await hre.network.provider.send('eth_getTransactionReceipt', [b.hash])

      const aGas = BigNumber.from(aReceipt['gasUsed'])
      const bGas = BigNumber.from(bReceipt['gasUsed'])

      expect(aGas).to.be.gt(300000)
      expect(bGas).to.be.lt(250000)

      await hre.network.provider.send('evm_setAutomine', [true])
    })

    it('Multiple collectAndUpdate in one block (Breaks if GasReport enabled)', async () => {
      const amountToDeposit = utils.parseEther('5')

      // Just preparation
      await waitForTx(await weth.deposit({ value: amountToDeposit.mul(2) }))
      await waitForTx(
        await weth.approve(staticBendWeth.address, amountToDeposit.mul(2), defaultTxParams)
      )

      // Depositing
      await waitForTx(
        await staticBendWeth.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
      )

      await hre.network.provider.send('evm_setAutomine', [false])

      const a = await staticBendWeth.collectAndUpdateRewards()
      const b = await staticBendWeth.collectAndUpdateRewards()

      await hre.network.provider.send('evm_mine', [])

      const aReceipt = await hre.network.provider.send('eth_getTransactionReceipt', [a.hash])
      const bReceipt = await hre.network.provider.send('eth_getTransactionReceipt', [b.hash])

      const aGas = BigNumber.from(aReceipt['gasUsed'])
      const bGas = BigNumber.from(bReceipt['gasUsed'])

      expect(aGas).to.be.gt(200000)
      expect(bGas).to.be.lt(100000)

      await hre.network.provider.send('evm_setAutomine', [true])
    })

    it('Update and claim', async () => {
      const amountToDeposit = utils.parseEther('5')

      // Just preparation
      await waitForTx(await weth.deposit({ value: amountToDeposit.mul(2) }))
      await waitForTx(
        await weth.approve(staticBendWeth.address, amountToDeposit.mul(2), defaultTxParams)
      )

      // Depositing
      await waitForTx(
        await staticBendWeth.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
      )

      const pendingRewards1 = await staticBendWeth.getClaimableRewards(userSigner._address)

      // Depositing
      await waitForTx(
        await staticBendWeth.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
      )

      const pendingRewards2 = await staticBendWeth.getClaimableRewards(userSigner._address)

      await waitForTx(await staticBendWeth.collectAndUpdateRewards())

      const pendingRewards3 = await staticBendWeth.getClaimableRewards(userSigner._address)
      const claimedRewards3 = await bend.balanceOf(userSigner._address)

      await waitForTx(await staticBendWeth.connect(userSigner).claimRewardsToSelf(true))

      const pendingRewards4 = await staticBendWeth.getClaimableRewards(userSigner._address)
      const claimedRewards4 = await bend.balanceOf(userSigner._address)

      expect(pendingRewards1).to.be.eq(0)
      expect(pendingRewards2).to.be.gt(pendingRewards1)
      expect(pendingRewards3).to.be.gt(pendingRewards2)
      expect(pendingRewards4).to.be.eq(0)

      expect(claimedRewards3).to.be.eq(0)
      expect(claimedRewards4).to.be.gt(pendingRewards3)
    })

    it('Withdraw to other user', async () => {
      const amountToDeposit = utils.parseEther('5')
      const amountToWithdraw = MAX_UINT256

      const recipient = user2Signer._address

      // Just preparation
      await waitForTx(await weth.deposit({ value: amountToDeposit.mul(2) }))
      await waitForTx(
        await weth.approve(staticBendWeth.address, amountToDeposit.mul(2), defaultTxParams)
      )

      // Depositing
      await waitForTx(
        await staticBendWeth.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
      )

      const userPendingRewards1 = await staticBendWeth.getClaimableRewards(userSigner._address)
      const recipientPendingRewards1 = await staticBendWeth.getClaimableRewards(recipient)

      // Withdrawing all
      await waitForTx(
        await staticBendWeth.withdraw(recipient, amountToWithdraw, true, defaultTxParams)
      )

      const userPendingRewards2 = await staticBendWeth.getClaimableRewards(userSigner._address)
      const recipientPendingRewards2 = await staticBendWeth.getClaimableRewards(recipient)

      // Check that the recipient have gotten the rewards
      expect(userPendingRewards2).to.be.gt(userPendingRewards1)
      expect(recipientPendingRewards1).to.be.eq(0)
      expect(recipientPendingRewards2).to.be.eq(0)
    })

    it('Deposit, Wait, Withdraw, claim?', async () => {
      const amountToDeposit = utils.parseEther('5')
      const amountToWithdraw = MAX_UINT256

      // Just preparation
      await waitForTx(await weth.deposit({ value: amountToDeposit.mul(2) }))
      await waitForTx(
        await weth.approve(staticBendWeth.address, amountToDeposit.mul(2), defaultTxParams)
      )

      // Depositing
      await waitForTx(
        await staticBendWeth.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
      )

      const pendingRewards1 = await staticBendWeth.getClaimableRewards(userSigner._address)

      await advanceTime(60 * 60)

      const pendingRewards2 = await staticBendWeth.getClaimableRewards(userSigner._address)

      // Withdrawing all.
      await waitForTx(
        await staticBendWeth.withdraw(userSigner._address, amountToWithdraw, true, defaultTxParams)
      )

      // How will my pending look now
      const pendingRewards3 = await staticBendWeth.getClaimableRewards(userSigner._address)

      await waitForTx(await staticBendWeth.connect(userSigner).claimRewardsToSelf(true))

      const pendingRewards4 = await staticBendWeth.getClaimableRewards(userSigner._address)
      const userBalance4 = await bend.balanceOf(userSigner._address)

      expect(pendingRewards1).to.be.eq(0)
      expect(pendingRewards2).to.be.gt(pendingRewards1)
      expect(pendingRewards3).to.be.gt(pendingRewards2)
      expect(pendingRewards4).to.be.eq(0)
      expect(userBalance4).to.be.eq(pendingRewards3)
    })

    it('Deposit, Wait, Withdraw, claim to other user', async () => {
      const amountToDeposit = utils.parseEther('5')
      const amountToWithdraw = MAX_UINT256

      // Just preparation
      await waitForTx(await weth.deposit({ value: amountToDeposit.mul(2) }))
      await waitForTx(
        await weth.approve(staticBendWeth.address, amountToDeposit.mul(2), defaultTxParams)
      )

      // Depositing
      await waitForTx(
        await staticBendWeth.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
      )

      const pendingRewards1 = await staticBendWeth.getClaimableRewards(userSigner._address)

      await advanceTime(60 * 60)

      const pendingRewards2 = await staticBendWeth.getClaimableRewards(userSigner._address)

      // Withdrawing all.
      await waitForTx(
        await staticBendWeth.withdraw(userSigner._address, amountToWithdraw, true, defaultTxParams)
      )

      // How will my pending look now
      const pendingRewards3 = await staticBendWeth.getClaimableRewards(userSigner._address)

      const userBalance3 = await bend.balanceOf(userSigner._address)
      await staticBendWeth.connect(user2Signer).claimRewards(userSigner._address, true)
      const userBalance4 = await bend.balanceOf(userSigner._address)

      await waitForTx(
        await staticBendWeth.connect(userSigner).claimRewards(user2Signer._address, true)
      )

      const pendingRewards5 = await staticBendWeth.getClaimableRewards(userSigner._address)
      const user2Balance5 = await bend.balanceOf(user2Signer._address)

      expect(pendingRewards1).to.be.eq(0)
      expect(pendingRewards2).to.be.gt(pendingRewards1)
      expect(pendingRewards3).to.be.gt(pendingRewards2)
      expect(userBalance3).to.be.eq(userBalance4)
      expect(pendingRewards5).to.be.eq(0)
      expect(user2Balance5).to.be.eq(pendingRewards3)
    })

    it('Deposit, Wait, collectAndUpdate, Withdraw, claim?', async () => {
      const amountToDeposit = utils.parseEther('5')
      const amountToWithdraw = MAX_UINT256

      // Just preparation
      await waitForTx(await weth.deposit({ value: amountToDeposit.mul(2) }))
      await waitForTx(
        await weth.approve(staticBendWeth.address, amountToDeposit.mul(2), defaultTxParams)
      )

      // Depositing
      await waitForTx(
        await staticBendWeth.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
      )

      const pendingRewards1 = await staticBendWeth.getClaimableRewards(userSigner._address)

      await advanceTime(60 * 60)
      await waitForTx(await staticBendWeth.collectAndUpdateRewards())

      const pendingRewards2 = await staticBendWeth.getClaimableRewards(userSigner._address)

      // Withdrawing all.
      await waitForTx(
        await staticBendWeth.withdraw(userSigner._address, amountToWithdraw, true, defaultTxParams)
      )

      const pendingRewards3 = await staticBendWeth.getClaimableRewards(userSigner._address)

      await waitForTx(await staticBendWeth.connect(userSigner).claimRewardsToSelf(true))

      const pendingRewards4 = await staticBendWeth.getClaimableRewards(userSigner._address)
      const userBalance4 = await bend.balanceOf(userSigner._address)

      expect(pendingRewards1).to.be.eq(0)
      expect(pendingRewards2).to.be.gt(pendingRewards1)
      expect(pendingRewards3).to.be.gt(pendingRewards2)
      expect(pendingRewards4).to.be.eq(0)
      expect(userBalance4).to.be.eq(pendingRewards3)
    })

    it('Throw away as much as possible: Deposit, collectAndUpdate, wait, Withdraw, claim', async () => {
      const amountToDeposit = utils.parseEther('5')
      const amountToWithdraw = MAX_UINT256

      // Just preparation
      await waitForTx(await weth.deposit({ value: amountToDeposit.mul(2) }))
      await waitForTx(
        await weth.approve(staticBendWeth.address, amountToDeposit.mul(2), defaultTxParams)
      )

      // Depositing
      await waitForTx(
        await staticBendWeth.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
      )

      const pendingRewards1 = await staticBendWeth.getClaimableRewards(userSigner._address)

      await waitForTx(await staticBendWeth.collectAndUpdateRewards())
      await advanceTime(60 * 60)

      const pendingRewards2 = await staticBendWeth.getClaimableRewards(userSigner._address)

      // Withdrawing all.
      await waitForTx(
        await staticBendWeth.withdraw(userSigner._address, amountToWithdraw, true, defaultTxParams)
      )

      // How will my pending look now
      const pendingRewards3 = await staticBendWeth.getClaimableRewards(userSigner._address)
      const unclaimedRewards3 = await staticBendWeth.getUnclaimedRewards(userSigner._address)

      await waitForTx(await staticBendWeth.connect(userSigner).claimRewardsToSelf(false))

      const pendingRewards4 = await staticBendWeth.getClaimableRewards(userSigner._address)
      const userBalance4 = await bend.balanceOf(userSigner._address)
      const totClaimable4 = await staticBendWeth.getTotalClaimableRewards()
      const unclaimedRewards4 = await staticBendWeth.getUnclaimedRewards(userSigner._address)

      expect(pendingRewards1).to.be.eq(0)
      expect(pendingRewards2).to.be.gt(0)
      expect(pendingRewards3).to.be.gt(pendingRewards2)
      expect(pendingRewards4).to.be.eq(0)
      expect(userBalance4).to.be.gt(0)
      expect(userBalance4).to.be.lt(unclaimedRewards3)
      expect(totClaimable4).to.be.gt(0)
      expect(totClaimable4).to.be.gt(userBalance4)
      expect(unclaimedRewards4).to.be.eq(0)
    })
  })

  it('Multiple users deposit WETH on staticBendWETH, wait 1 hour, update rewards, one user transfer, then claim and update rewards.', async () => {
    // In this case, the recipient should have approx 1.5 the rewards of the others.

    // 1. Deposit
    // 2. Wait 3600 seconds
    // 2-5. Update rewards
    // 3. Transfer
    // 4. Wait 3600 seconds
    // 5. Claim rewards
    // 6. Update rewards

    const amountToDeposit = utils.parseEther('5')
    const allusers = await hre.ethers.getSigners()
    const users = [allusers[0], allusers[1], allusers[2], allusers[3], allusers[4]]

    const _debugUserData = false

    for (let i = 0; i < 5; i++) {
      const currentUser = users[i]
      // Preparation
      await waitForTx(await weth.connect(currentUser).deposit({ value: amountToDeposit }))
      await waitForTx(
        await weth
          .connect(currentUser)
          .approve(staticBendWeth.address, amountToDeposit, defaultTxParams)
      )

      // Deposit
      await waitForTx(
        await staticBendWeth
          .connect(currentUser)
          .deposit(await currentUser.getAddress(), amountToDeposit, 0, true, defaultTxParams)
      )
    }

    // Advance time to accrue significant rewards.
    await advanceTime(60 * 60)
    await staticBendWeth.collectAndUpdateRewards()

    const staticBendWethTotClaimableInitial = await staticBendWeth.getTotalClaimableRewards()
    const usersDataInitial = await getUserData(users, _debugUserData, staticBendWeth, bend)

    await waitForTx(
      await staticBendWeth
        .connect(users[0])
        .transfer(
          await users[1].getAddress(),
          await staticBendWeth.balanceOf(await users[0].getAddress())
        )
    )

    await advanceTime(60 * 60)

    for (let i = 0; i < 5; i++) {
      // This will claim the first half of the collected tokens (those collected at `collectAndUpdateRewards`)
      await waitForTx(await staticBendWeth.connect(users[i]).claimRewardsToSelf(false))
    }

    const staticBendWethTotClaimableAfterTransferAndClaim =
      await staticBendWeth.getTotalClaimableRewards()
    const usersDataAfterTransferAndClaim = await getUserData(
      users,
      _debugUserData,
      staticBendWeth,
      bend
    )

    await waitForTx(await staticBendWeth.collectAndUpdateRewards())

    const staticBendWethTotClaimableFinal = await staticBendWeth.getTotalClaimableRewards()
    const usersDataFinal = await getUserData(users, _debugUserData, staticBendWeth, bend)

    // Time for checks
    let pendingRewardsSumInitial = BigNumber.from(0)
    let pendingRewardsSumAfter = BigNumber.from(0)
    let pendingRewardsSumFinal = BigNumber.from(0)
    for (let i = 0; i < 5; i++) {
      expect(usersDataInitial[i].bendBalance).to.be.eq(0)
      expect(usersDataAfterTransferAndClaim[i].bendBalance).to.be.eq(
        usersDataInitial[i].pendingRewards
      )
      if (i > 1) {
        // Expect initial static balance == after transfer == after claiming
        expect(usersDataInitial[i].staticBalance).to.be.eq(
          usersDataAfterTransferAndClaim[i].staticBalance
        )
        expect(usersDataInitial[i].staticBalance).to.be.eq(usersDataFinal[i].staticBalance)
        expect(usersDataInitial[i].pendingRewards.add(usersDataInitial[i].bendBalance)).to.be.lt(
          usersDataAfterTransferAndClaim[i].pendingRewards.add(
            usersDataAfterTransferAndClaim[i].bendBalance
          )
        )
        expect(
          usersDataAfterTransferAndClaim[i].pendingRewards.add(
            usersDataAfterTransferAndClaim[i].bendBalance
          )
        ).to.be.lt(usersDataFinal[i].pendingRewards.add(usersDataFinal[i].bendBalance))
      }

      pendingRewardsSumInitial = pendingRewardsSumInitial.add(usersDataInitial[i].pendingRewards)
      pendingRewardsSumAfter = pendingRewardsSumAfter.add(
        usersDataAfterTransferAndClaim[i].pendingRewards
      )
      pendingRewardsSumFinal = pendingRewardsSumFinal.add(usersDataFinal[i].pendingRewards)
    }

    // Expect user 0 to accrue zero fees after the transfer
    expect(usersDataAfterTransferAndClaim[0].staticBalance).to.be.eq(0)
    expect(usersDataAfterTransferAndClaim[0].pendingRewards).to.be.eq(0)
    expect(usersDataFinal[0].staticBalance).to.be.eq(0)
    expect(usersDataFinal[0].pendingRewards).to.be.eq(0)

    // Expect user 1 to have received funds
    expect(usersDataAfterTransferAndClaim[1].staticBalance).to.be.eq(
      usersDataInitial[1].staticBalance.add(usersDataInitial[0].staticBalance)
    )
    //
    // Expect user 1 to have accrued more than twice in pending rewards.
    // note that we get very little rewards in the transfer, because of the fresh update.
    //

    expect(usersDataFinal[1].pendingRewards).to.be.gt(usersDataFinal[2].pendingRewards.mul(2))
    // Expect his total fees to be almost 1.5 as large. Because of the small initial diff
    expect(usersDataFinal[1].pendingRewards.add(usersDataFinal[1].bendBalance)).to.be.gt(
      usersDataFinal[2].pendingRewards.add(usersDataFinal[2].bendBalance).mul(145).div(100)
    )
    expect(usersDataFinal[1].pendingRewards.add(usersDataFinal[1].bendBalance)).to.be.lt(
      usersDataFinal[2].pendingRewards.add(usersDataFinal[2].bendBalance).mul(155).div(100)
    )

    // Expect there to be excess bend in the contract. Expect it to be dust. This ensure that everyone can claim full amount of rewards.
    expect(pendingRewardsSumInitial).to.be.lte(staticBendWethTotClaimableInitial)
    expect(staticBendWethTotClaimableInitial.sub(pendingRewardsSumInitial)).to.be.lte(DUST)

    expect(pendingRewardsSumAfter).to.be.lte(staticBendWethTotClaimableAfterTransferAndClaim)
    expect(staticBendWethTotClaimableAfterTransferAndClaim.sub(pendingRewardsSumAfter)).to.be.lte(
      DUST
    )

    expect(pendingRewardsSumFinal).to.be.lte(staticBendWethTotClaimableFinal)
    expect(staticBendWethTotClaimableFinal.sub(pendingRewardsSumFinal)).to.be.lte(DUST)
  })

  it('Multiple users deposit WETH on staticBendWETH, wait 1 hour, one user transfer, then claim and update rewards.', async () => {
    // In this case, the recipient should have approx twice the rewards.
    // Note that he has not held the 2x  balance for this entire time, but only for one block.
    // He have gotten this extra reward from the sender, because there was not a update prior.

    // 1. Deposit
    // 2. Wait 3600 seconds
    // 3. Transfer
    // 4. Wait 3600 seconds
    // 5. Claim rewards
    // 6. Update rewards

    const amountToDeposit = utils.parseEther('5')
    const allusers = await hre.ethers.getSigners()
    const users = [allusers[0], allusers[1], allusers[2], allusers[3], allusers[4]]

    const _debugUserData = false

    for (let i = 0; i < 5; i++) {
      const currentUser = users[i]
      // Preparation
      await waitForTx(await weth.connect(currentUser).deposit({ value: amountToDeposit }))
      await waitForTx(
        await weth
          .connect(currentUser)
          .approve(staticBendWeth.address, amountToDeposit, defaultTxParams)
      )

      // Deposit
      await waitForTx(
        await staticBendWeth
          .connect(currentUser)
          .deposit(await currentUser.getAddress(), amountToDeposit, 0, true, defaultTxParams)
      )
    }

    // Advance time to accrue significant rewards.
    await advanceTime(60 * 60)

    const staticBendWethTotClaimableInitial = await staticBendWeth.getTotalClaimableRewards()
    const usersDataInitial = await getUserData(users, _debugUserData, staticBendWeth, bend)

    // User 0 transfer full balance of staticBendWeths to user 1. This will also transfer the rewards since last update as well.
    await waitForTx(
      await staticBendWeth
        .connect(users[0])
        .transfer(
          await users[1].getAddress(),
          await staticBendWeth.balanceOf(await users[0].getAddress())
        )
    )

    await advanceTime(60 * 60)

    for (let i = 0; i < 5; i++) {
      // This will not do anything, hence there is no rewards in the current contract.
      await waitForTx(await staticBendWeth.connect(users[i]).claimRewardsToSelf(false))
    }

    const staticBendWethTotClaimableAfterTransfer = await staticBendWeth.getTotalClaimableRewards()
    const usersDataAfterTransfer = await getUserData(users, _debugUserData, staticBendWeth, bend)

    await waitForTx(await staticBendWeth.collectAndUpdateRewards())

    const staticBendWethTotClaimableFinal = await staticBendWeth.getTotalClaimableRewards()
    const usersDataFinal = await getUserData(users, _debugUserData, staticBendWeth, bend)

    // Time for checks
    let pendingRewardsSumInitial = BigNumber.from(0)
    let pendingRewardsSumAfter = BigNumber.from(0)
    let pendingRewardsSumFinal = BigNumber.from(0)
    for (let i = 0; i < 5; i++) {
      expect(usersDataInitial[i].bendBalance).to.be.eq(0)
      expect(usersDataAfterTransfer[i].bendBalance).to.be.eq(0)
      expect(usersDataFinal[i].bendBalance).to.be.eq(0)
      if (i > 1) {
        // Expect initial static balance == after transfer == after claiming
        expect(usersDataInitial[i].staticBalance).to.be.eq(usersDataAfterTransfer[i].staticBalance)
        expect(usersDataInitial[i].staticBalance).to.be.eq(usersDataFinal[i].staticBalance)
      }

      pendingRewardsSumInitial = pendingRewardsSumInitial.add(usersDataInitial[i].pendingRewards)
      pendingRewardsSumAfter = pendingRewardsSumAfter.add(usersDataAfterTransfer[i].pendingRewards)
      pendingRewardsSumFinal = pendingRewardsSumFinal.add(usersDataFinal[i].pendingRewards)
    }

    expect(await staticBendWeth.getTotalClaimableRewards()).to.be.eq(
      await bend.balanceOf(staticBendWeth.address)
    )

    // Another dude gets our unclaimed rewards
    expect(usersDataInitial[0].pendingRewards).to.be.gt(usersDataAfterTransfer[0].pendingRewards)
    expect(usersDataAfterTransfer[0].pendingRewards).to.be.eq(usersDataFinal[0].pendingRewards)

    expect(usersDataAfterTransfer[0].staticBalance).to.be.eq(0)
    expect(usersDataFinal[0].staticBalance).to.be.eq(0)

    // Expect user 1 to have received funds
    expect(usersDataAfterTransfer[1].staticBalance).to.be.eq(
      usersDataInitial[1].staticBalance.add(usersDataInitial[0].staticBalance)
    )

    //
    // Expect user 1 to have pending almost twice the rewards as the last user.
    // Note that he should have accrued this, even though he did not have 2x bal for the full time,
    // as he also received the "uncollected" rewards from user1 at the transfer.
    // Lack of precision due to small initial diff.
    //
    expect(usersDataFinal[1].pendingRewards).to.be.gt(
      usersDataFinal[2].pendingRewards.mul(195).div(100)
    )
    expect(usersDataFinal[1].pendingRewards).to.be.lt(
      usersDataFinal[2].pendingRewards.mul(205).div(100)
    )

    // Expect there to be excess bend in the contract.
    // Expect it to be dust. This ensure that everyone can claim full amount of rewards.
    expect(pendingRewardsSumInitial).to.be.lte(staticBendWethTotClaimableInitial)
    expect(staticBendWethTotClaimableInitial.sub(pendingRewardsSumInitial)).to.be.lte(DUST)

    expect(pendingRewardsSumAfter).to.be.lte(staticBendWethTotClaimableAfterTransfer)
    expect(staticBendWethTotClaimableAfterTransfer.sub(pendingRewardsSumAfter)).to.be.lte(DUST)

    expect(pendingRewardsSumFinal).to.be.lte(staticBendWethTotClaimableFinal)
    expect(staticBendWethTotClaimableFinal.sub(pendingRewardsSumFinal)).to.be.lte(DUST) // How small should we say dust is?
  })

  it('Mass deposit, then mass claim to own account', async () => {
    const amountToDeposit = utils.parseEther('1.1') // 18 decimals should be the worst here //1.135359735917531199
    const users = await hre.ethers.getSigners()

    const depositCount = users.length

    for (let i = 0; i < depositCount; i++) {
      const currentUser = users[i % users.length]
      // Preparation
      await waitForTx(await weth.connect(currentUser).deposit({ value: amountToDeposit }))
      await waitForTx(
        await weth
          .connect(currentUser)
          .approve(staticBendWeth.address, amountToDeposit, defaultTxParams)
      )

      // Deposit
      await waitForTx(
        await staticBendWeth
          .connect(currentUser)
          .deposit(await currentUser.getAddress(), amountToDeposit, 0, true, defaultTxParams)
      )
    }

    // Advance time to accrue significant rewards.
    await advanceTime(60 * 60)
    await waitForTx(await staticBendWeth.collectAndUpdateRewards())

    const pendingRewards: BigNumber[] = []

    for (let i = 0; i < users.length; i++) {
      const pendingReward = await staticBendWeth.getClaimableRewards(await users[i].getAddress())
      pendingRewards.push(pendingReward)
    }
    for (let i = 0; i < users.length; i++) {
      await waitForTx(await staticBendWeth.connect(users[i]).claimRewardsToSelf(false))
      expect(await bend.balanceOf(await users[i].getAddress())).to.be.eq(pendingRewards[i])
    }
    expect(await bend.balanceOf(staticBendWeth.address)).to.be.lt(DUST)
  })

  it('Mass deposit, then mass claim to specified account', async () => {
    const amountToDeposit = utils.parseEther('1.1') // 18 decimals should be the worst here //1.135359735917531199
    const users = await hre.ethers.getSigners()

    const depositCount = users.length

    for (let i = 0; i < depositCount; i++) {
      const currentUser = users[i % users.length]
      // Preparation
      await waitForTx(await weth.connect(currentUser).deposit({ value: amountToDeposit }))
      await waitForTx(
        await weth
          .connect(currentUser)
          .approve(staticBendWeth.address, amountToDeposit, defaultTxParams)
      )

      // Deposit
      await waitForTx(
        await staticBendWeth
          .connect(currentUser)
          .deposit(await currentUser.getAddress(), amountToDeposit, 0, true, defaultTxParams)
      )
    }

    // Advance time to accrue significant rewards.
    await advanceTime(60 * 60)
    await waitForTx(await staticBendWeth.collectAndUpdateRewards())

    const pendingRewards: BigNumber[] = []
    let sum: BigNumber = BigNumber.from(0)
    const receiverAddress = await users[0].getAddress()

    for (let i = 0; i < users.length; i++) {
      const pendingReward = await staticBendWeth.getClaimableRewards(await users[i].getAddress())
      pendingRewards.push(pendingReward)
    }
    for (let i = 0; i < users.length; i++) {
      await waitForTx(await staticBendWeth.connect(users[i]).claimRewards(receiverAddress, false))
      sum = sum.add(pendingRewards[i])
      expect(await bend.balanceOf(await receiverAddress)).to.be.eq(sum)
    }
    expect(await bend.balanceOf(staticBendWeth.address)).to.be.lt(DUST)
  })

  it('Mass deposits, mass withdraws and mass claims', async () => {
    const amountToDeposit = utils.parseEther('1.135359735917531199') // 18 decimals should be the worst here //1.135359735917531199
    const users = await hre.ethers.getSigners()

    const depositCount = users.length

    for (let i = 0; i < depositCount; i++) {
      const currentUser = users[i % users.length]
      // Preparation
      await waitForTx(await weth.connect(currentUser).deposit({ value: amountToDeposit }))
      await waitForTx(
        await weth
          .connect(currentUser)
          .approve(staticBendWeth.address, amountToDeposit, defaultTxParams)
      )

      // Deposit
      await waitForTx(
        await staticBendWeth
          .connect(currentUser)
          .deposit(await currentUser.getAddress(), amountToDeposit, 0, true, defaultTxParams)
      )

      await advanceTime(60)

      await waitForTx(
        await staticBendWeth
          .connect(currentUser)
          .withdraw(await currentUser.getAddress(), MAX_UINT256, true, defaultTxParams)
      )

      const pendingReward = await staticBendWeth.getClaimableRewards(await users[i].getAddress())
      await waitForTx(await staticBendWeth.connect(users[i]).claimRewardsToSelf(true))
      expect(await bend.balanceOf(await users[i].getAddress())).to.be.eq(pendingReward)
    }
  })

  it('Checks that withdraw and collect in different blocks updates _lifetimeRewardsClaimed as expected', async () => {
    const users = await hre.ethers.getSigners()
    const user = users[0]
    const depositAmount = utils.parseEther('1')

    // Preparation
    await waitForTx(await weth.connect(user).deposit({ value: depositAmount }))
    await waitForTx(
      await weth.connect(user).approve(staticBendWeth.address, depositAmount, defaultTxParams)
    )

    // Deposit
    await waitForTx(
      await staticBendWeth
        .connect(user)
        .deposit(await user.getAddress(), depositAmount, 0, true, defaultTxParams)
    )

    await advanceTime(60)

    expect(await staticBendWeth.getLifetimeRewardsClaimed()).to.be.eq(0)
    expect(await staticBendWeth.getClaimableRewards(user.address)).to.be.gt(0)
    expect(await bend.balanceOf(user.address)).to.be.eq(0)

    await waitForTx(await staticBendWeth.connect(user).withdraw(user.address, MAX_UINT256, true))
    await staticBendWeth.collectAndUpdateRewards()
    await staticBendWeth.connect(user).claimRewardsToSelf(false)

    expect(await staticBendWeth.getLifetimeRewardsClaimed()).to.be.gt(0)
    expect(await staticBendWeth.getClaimableRewards(user.address)).to.be.eq(0)
    expect(await bend.balanceOf(user.address)).to.be.gt(0)
  })

  it('Checks that withdraw and collect in the same block updates _lifetimeRewardsClaimed as expected (Breaks if GasReport is enabled)', async () => {
    const users = await hre.ethers.getSigners()
    const user = users[0]
    const depositAmount = utils.parseEther('1')

    // Preparation
    await waitForTx(await weth.connect(user).deposit({ value: depositAmount }))
    await waitForTx(
      await weth.connect(user).approve(staticBendWeth.address, depositAmount, defaultTxParams)
    )

    // Deposit
    await waitForTx(
      await staticBendWeth
        .connect(user)
        .deposit(await user.getAddress(), depositAmount, 0, true, defaultTxParams)
    )

    await advanceTime(60)

    expect(await staticBendWeth.getLifetimeRewardsClaimed()).to.be.eq(0)
    expect(await staticBendWeth.getClaimableRewards(user.address)).to.be.gt(0)
    expect(await bend.balanceOf(user.address)).to.be.eq(0)

    await hre.network.provider.send('evm_setAutomine', [false])

    await staticBendWeth.connect(user).withdraw(user.address, MAX_UINT256, true)
    await staticBendWeth.collectAndUpdateRewards()
    await staticBendWeth.connect(user).claimRewardsToSelf(false)

    await hre.network.provider.send('evm_mine', [])
    await hre.network.provider.send('evm_setAutomine', [true])

    expect(await staticBendWeth.getLifetimeRewardsClaimed()).to.be.gt(0)
    expect(await staticBendWeth.getClaimableRewards(user.address)).to.be.eq(0)
    expect(await bend.balanceOf(user.address)).to.be.gt(0)
  })
})
