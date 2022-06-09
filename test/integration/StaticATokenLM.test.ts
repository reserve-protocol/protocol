import hre, { ethers } from 'hardhat'
import bnjs from 'bignumber.js'
import { solidity } from 'ethereum-waffle'
import { parseEther, _TypedDataEncoder } from 'ethers/lib/utils'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import forkBlockNumber from './fork-block-numbers'
import { whileImpersonating } from '../utils/impersonation'
import {
  buildPermitParams,
  buildMetaDepositParams,
  buildMetaWithdrawParams,
  waitForTx,
  evmRevert,
  evmSnapshot,
} from './utils'
import { BigNumber, ContractFactory, providers, utils } from 'ethers'
import { rayDiv, rayMul } from './ray-math'
import { MAX_UINT256, ZERO_ADDRESS } from '../../common/constants'
import {
  AAVE_EMISSIONS_MGR_ADDRESS,
  AAVE_INCENTIVES_ADDRESS,
  AAVE_LENDING_POOL_ADDRESS,
  AWETH_ADDRESS,
  STAKEDAAVE_ADDRESS,
  WETH_ADDRESS,
} from './mainnet'

import {
  ERC20Mock,
  IAaveIncentivesController,
  ILendingPool,
  IAToken,
  IWETH,
  SelfdestructTransfer,
  StaticATokenLM,
} from '../../typechain'

const { expect, use } = require('chai')

use(solidity)

// Setup test environment
const setup = async (blockNumber: number) => {
  // Use Mainnet fork
  await hre.network.provider.request({
    method: 'hardhat_reset',
    params: [
      {
        forking: {
          jsonRpcUrl: process.env.MAINNET_RPC_URL,
          blockNumber: blockNumber,
        },
      },
    ],
  })
}

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
  staticATokenATokenBalance: BigNumber
  staticATokenStkAaveBalance: BigNumber
  staticATokenUnderlyingBalance: BigNumber
  staticATokenScaledBalanceAToken: BigNumber
  staticATokenTotalClaimableRewards: BigNumber
  userStkAaveBalance: BigNumber
  userATokenBalance: BigNumber
  userScaledBalanceAToken: BigNumber
  userUnderlyingBalance: BigNumber
  userStaticATokenBalance: BigNumber
  userDynamicStaticATokenBalance: BigNumber
  userPendingRewards: BigNumber
  user2StkAaveBalance: BigNumber
  user2ATokenBalance: BigNumber
  user2ScaledBalanceAToken: BigNumber
  user2UnderlyingBalance: BigNumber
  user2StaticATokenBalance: BigNumber
  user2DynamicStaticATokenBalance: BigNumber
  user2PendingRewards: BigNumber
  currentRate: BigNumber
  staticATokenSupply: BigNumber
}

type tContextParams = {
  staticAToken: StaticATokenLM
  underlying: ERC20Mock
  aToken: IAToken
  stkAave: ERC20Mock
  user: string
  user2: string
  lendingPool: ILendingPool
}

const getContext = async ({
  staticAToken,
  underlying,
  aToken,
  stkAave,
  user,
  user2,
  lendingPool,
}: tContextParams): Promise<tBalancesInvolved> => ({
  staticATokenATokenBalance: await aToken.balanceOf(staticAToken.address),
  staticATokenStkAaveBalance: await stkAave.balanceOf(staticAToken.address),
  staticATokenUnderlyingBalance: await underlying.balanceOf(staticAToken.address),
  staticATokenScaledBalanceAToken: await aToken.scaledBalanceOf(staticAToken.address),
  staticATokenTotalClaimableRewards: await staticAToken.getTotalClaimableRewards(),
  userStaticATokenBalance: await staticAToken.balanceOf(user),
  userStkAaveBalance: await stkAave.balanceOf(user),
  userATokenBalance: await aToken.balanceOf(user),
  userScaledBalanceAToken: await aToken.scaledBalanceOf(user),
  userUnderlyingBalance: await underlying.balanceOf(user),
  userDynamicStaticATokenBalance: await staticAToken.dynamicBalanceOf(user),
  userPendingRewards: await staticAToken.getClaimableRewards(user),
  user2StkAaveBalance: await stkAave.balanceOf(user2),
  user2ATokenBalance: await aToken.balanceOf(user2),
  user2ScaledBalanceAToken: await aToken.scaledBalanceOf(user2),
  user2UnderlyingBalance: await underlying.balanceOf(user2),
  user2StaticATokenBalance: await staticAToken.balanceOf(user2),
  user2DynamicStaticATokenBalance: await staticAToken.dynamicBalanceOf(user2),
  user2PendingRewards: await staticAToken.getClaimableRewards(user2),
  currentRate: await lendingPool.getReserveNormalizedIncome(WETH_ADDRESS),
  staticATokenSupply: await staticAToken.totalSupply(),
})

describe('StaticATokenLM: aToken wrapper with static balances and liquidity mining', () => {
  let user1: SignerWithAddress
  let user2: SignerWithAddress
  let userSigner: providers.JsonRpcSigner
  let user2Signer: providers.JsonRpcSigner
  let lendingPool: ILendingPool
  let incentives: IAaveIncentivesController
  let weth: IWETH
  let aweth: IAToken
  let stkAave: ERC20Mock

  let staticAToken: StaticATokenLM

  let snap: string

  let ctxtParams: tContextParams

  before(async () => {
    await setup(forkBlockNumber['aave-compound-rewards'])
    ;[user1, user2] = await ethers.getSigners()

    userSigner = hre.ethers.provider.getSigner(await user1.getAddress())
    user2Signer = hre.ethers.provider.getSigner(await user2.getAddress())

    lendingPool = <ILendingPool>(
      await ethers.getContractAt('ILendingPool', AAVE_LENDING_POOL_ADDRESS, userSigner)
    )
    incentives = <IAaveIncentivesController>(
      await ethers.getContractAt('IAaveIncentivesController', AAVE_INCENTIVES_ADDRESS, userSigner)
    )

    weth = <IWETH>await ethers.getContractAt('IWETH', WETH_ADDRESS, userSigner)
    aweth = <IAToken>await ethers.getContractAt('IAToken', AWETH_ADDRESS, userSigner)
    stkAave = <ERC20Mock>await ethers.getContractAt('ERC20Mock', STAKEDAAVE_ADDRESS, userSigner)

    const StaticATokenFactory: ContractFactory = await ethers.getContractFactory('StaticATokenLM')

    staticAToken = <StaticATokenLM>(
      await StaticATokenFactory.connect(userSigner).deploy(
        AAVE_LENDING_POOL_ADDRESS,
        AWETH_ADDRESS,
        'Static Aave Interest Bearing WETH',
        'stataWETH'
      )
    )

    expect(await staticAToken.getIncentivesController()).to.be.eq(AAVE_INCENTIVES_ADDRESS)

    ctxtParams = {
      staticAToken: <StaticATokenLM>staticAToken,
      underlying: <ERC20Mock>(<unknown>weth),
      aToken: <IAToken>aweth,
      stkAave: <ERC20Mock>stkAave,
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

  it('Deposit WETH on stataWETH, then withdraw of the whole balance in underlying', async () => {
    const amountToDeposit = utils.parseEther('5')
    const amountToWithdraw = MAX_UINT256

    // Just preparation
    await waitForTx(await weth.deposit({ value: amountToDeposit }))
    await waitForTx(await weth.approve(staticAToken.address, amountToDeposit, defaultTxParams))

    const ctxtInitial = await getContext(ctxtParams)

    await expect(
      staticAToken.deposit(ZERO_ADDRESS, amountToDeposit, 0, true, defaultTxParams)
    ).to.be.revertedWith(LM_ERRORS.INVALID_RECIPIENT)

    // Depositing
    await waitForTx(
      await staticAToken.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
    )

    const ctxtAfterDeposit = await getContext(ctxtParams)

    await expect(
      staticAToken.withdraw(ZERO_ADDRESS, amountToWithdraw, true, defaultTxParams)
    ).to.be.revertedWith(LM_ERRORS.INVALID_RECIPIENT)

    // Withdrawing all
    await waitForTx(
      await staticAToken.withdraw(userSigner._address, amountToWithdraw, true, defaultTxParams)
    )

    const ctxtAfterWithdrawal = await getContext(ctxtParams)

    // Claiming the rewards
    await waitForTx(await staticAToken.connect(userSigner).claimRewards(userSigner._address, false))

    const ctxtAfterClaimNoForce = await getContext(ctxtParams)

    await waitForTx(await staticAToken.connect(userSigner).claimRewards(userSigner._address, true))

    const ctxtAfterClaimForce = await getContext(ctxtParams)

    // Check that scaledAToken balance is equal to the static aToken supply at every stage.
    expect(ctxtInitial.staticATokenScaledBalanceAToken).to.be.eq(ctxtInitial.staticATokenSupply)
    expect(ctxtAfterDeposit.staticATokenScaledBalanceAToken).to.be.eq(
      ctxtAfterDeposit.staticATokenSupply
    )
    expect(ctxtAfterWithdrawal.staticATokenScaledBalanceAToken).to.be.eq(
      ctxtAfterWithdrawal.staticATokenSupply
    )
    expect(ctxtAfterClaimNoForce.staticATokenScaledBalanceAToken).to.be.eq(
      ctxtAfterClaimNoForce.staticATokenSupply
    )

    expect(ctxtAfterDeposit.staticATokenATokenBalance).to.be.eq(
      ctxtInitial.staticATokenATokenBalance.add(amountToDeposit)
    )
    expect(ctxtAfterDeposit.userUnderlyingBalance).to.be.eq(
      ctxtInitial.userUnderlyingBalance.sub(amountToDeposit)
    )
    expect(ctxtAfterDeposit.userDynamicStaticATokenBalance).to.be.eq(
      ctxtInitial.userDynamicStaticATokenBalance.add(amountToDeposit)
    )
    expect(ctxtAfterDeposit.userDynamicStaticATokenBalance).to.be.eq(
      ctxtAfterDeposit.staticATokenATokenBalance
    )
    expect(ctxtAfterDeposit.staticATokenUnderlyingBalance).to.be.eq(
      ctxtInitial.staticATokenUnderlyingBalance
    )
    expect(ctxtAfterDeposit.userATokenBalance).to.be.eq(ctxtInitial.userATokenBalance)
    expect(ctxtAfterDeposit.userStkAaveBalance).to.be.eq(0)
    expect(ctxtAfterDeposit.staticATokenStkAaveBalance).to.be.eq(0)

    expect(ctxtAfterWithdrawal.userStaticATokenBalance).to.be.eq(0)
    expect(ctxtAfterWithdrawal.staticATokenATokenBalance).to.be.eq(0)
    expect(ctxtAfterWithdrawal.staticATokenSupply).to.be.eq(0)
    expect(ctxtAfterWithdrawal.staticATokenUnderlyingBalance).to.be.eq(0)
    expect(ctxtAfterWithdrawal.staticATokenStkAaveBalance).to.be.eq(0)

    // Check with possible rounding error. Ahhh, it is because we have not claimed the shit after withdraw
    expect(ctxtAfterWithdrawal.staticATokenTotalClaimableRewards).to.be.gte(
      ctxtAfterWithdrawal.userPendingRewards
    )

    expect(ctxtAfterWithdrawal.staticATokenTotalClaimableRewards).to.be.lte(
      ctxtAfterWithdrawal.userPendingRewards.add(1)
    )
    expect(ctxtAfterWithdrawal.userStkAaveBalance).to.be.eq(0)

    expect(ctxtAfterClaimNoForce.userStkAaveBalance).to.be.eq(0)
    expect(ctxtAfterClaimNoForce.staticATokenStkAaveBalance).to.be.eq(0)

    expect(ctxtAfterClaimForce.userStkAaveBalance).to.be.eq(
      ctxtAfterClaimNoForce.userPendingRewards
    )
    expect(ctxtAfterClaimForce.staticATokenStkAaveBalance).to.be.eq(
      ctxtAfterClaimNoForce.staticATokenTotalClaimableRewards.sub(
        ctxtAfterClaimNoForce.userPendingRewards
      )
    )
  })

  it('Deposit WETH on stataWETH and then withdraw some balance in underlying', async () => {
    const amountToDeposit = utils.parseEther('5')
    const amountToWithdraw = utils.parseEther('2.5')

    // Preparation
    await waitForTx(await weth.deposit({ value: amountToDeposit }))
    await waitForTx(await weth.approve(staticAToken.address, amountToDeposit, defaultTxParams))

    const ctxtInitial = await getContext(ctxtParams)

    // Deposit
    await waitForTx(
      await staticAToken.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
    )

    const ctxtAfterDeposit = await getContext(ctxtParams)

    const expectedATokenWithdraw = await staticAToken.staticToDynamicAmount(amountToWithdraw)

    // Withdraw
    await waitForTx(
      await staticAToken.withdraw(userSigner._address, amountToWithdraw, true, defaultTxParams)
    )
    const ctxtAfterWithdrawal = await getContext(ctxtParams)

    // Claim
    await waitForTx(await staticAToken.connect(userSigner).claimRewards(userSigner._address, false))
    const ctxtAfterClaim = await getContext(ctxtParams)

    await waitForTx(await staticAToken.collectAndUpdateRewards())
    const ctxtAfterUpdate = await getContext(ctxtParams)

    await waitForTx(await staticAToken.connect(userSigner).claimRewards(userSigner._address, false))
    const ctxtAfterClaim2 = await getContext(ctxtParams)

    expect(ctxtInitial.userStaticATokenBalance).to.be.eq(0)
    expect(ctxtInitial.staticATokenSupply).to.be.eq(0)
    expect(ctxtInitial.staticATokenUnderlyingBalance).to.be.eq(0)
    expect(ctxtAfterDeposit.userDynamicStaticATokenBalance).to.be.eq(
      ctxtAfterDeposit.staticATokenATokenBalance
    )
    expect(ctxtAfterDeposit.userStaticATokenBalance).to.be.eq(ctxtAfterDeposit.staticATokenSupply)
    expect(ctxtAfterDeposit.staticATokenATokenBalance).to.be.eq(
      ctxtAfterDeposit.userDynamicStaticATokenBalance
    )
    expect(ctxtAfterDeposit.staticATokenATokenBalance).to.be.eq(amountToDeposit)

    expect(ctxtAfterWithdrawal.userDynamicStaticATokenBalance).to.be.eq(
      BigNumber.from(
        rayMul(
          new bnjs(ctxtAfterDeposit.userStaticATokenBalance.sub(amountToWithdraw).toString()),
          new bnjs(ctxtAfterWithdrawal.currentRate.toString())
        ).toString()
      )
    )
    expect(ctxtAfterWithdrawal.userStaticATokenBalance).to.be.eq(
      ctxtAfterDeposit.userStaticATokenBalance.sub(amountToWithdraw)
    )

    expect(ctxtAfterUpdate.userStkAaveBalance).to.be.eq(0)
    expect(ctxtAfterClaim2.userStkAaveBalance).to.be.eq(ctxtAfterUpdate.userPendingRewards)
    expect(ctxtAfterClaim2.userPendingRewards).to.be.gt(0)

    // Check that rewards are always covered
    expect(ctxtInitial.staticATokenTotalClaimableRewards).to.be.gte(ctxtInitial.userPendingRewards)
    expect(ctxtAfterDeposit.staticATokenTotalClaimableRewards).to.be.gte(
      ctxtAfterDeposit.userPendingRewards
    )
    expect(ctxtAfterWithdrawal.staticATokenTotalClaimableRewards).to.be.gte(
      ctxtAfterWithdrawal.userPendingRewards
    )
    expect(ctxtAfterClaim.staticATokenTotalClaimableRewards).to.be.gte(
      ctxtAfterClaim.userPendingRewards
    )
    expect(ctxtAfterUpdate.staticATokenTotalClaimableRewards).to.be.gte(
      ctxtAfterUpdate.userPendingRewards
    )
    expect(ctxtAfterClaim2.staticATokenTotalClaimableRewards).to.be.gte(
      ctxtAfterClaim2.userPendingRewards
    )
  })

  it('Deposit WETH on stataWETH and then withdraw all the balance in aToken', async () => {
    const amountToDeposit = utils.parseEther('5')
    const amountToWithdraw = MAX_UINT256

    // Preparation
    await waitForTx(await weth.deposit({ value: amountToDeposit }))
    await waitForTx(await weth.approve(staticAToken.address, amountToDeposit, defaultTxParams))

    const ctxtInitial = await getContext(ctxtParams)

    // Deposit
    await waitForTx(
      await staticAToken.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
    )

    const ctxtAfterDeposit = await getContext(ctxtParams)

    // Withdraw
    await waitForTx(
      await staticAToken.withdraw(userSigner._address, amountToWithdraw, false, defaultTxParams)
    )

    const ctxtAfterWithdrawal = await getContext(ctxtParams)

    expect(ctxtInitial.staticATokenSupply).to.be.eq(0)
    expect(ctxtInitial.userATokenBalance).to.be.eq(0)
    expect(ctxtAfterDeposit.staticATokenATokenBalance).to.be.eq(
      ctxtAfterDeposit.userDynamicStaticATokenBalance
    )
    expect(ctxtAfterDeposit.userStaticATokenBalance).to.be.eq(ctxtAfterDeposit.staticATokenSupply)
    expect(ctxtAfterDeposit.userDynamicStaticATokenBalance).to.be.eq(amountToDeposit)
    expect(ctxtAfterWithdrawal.userATokenBalance).to.be.eq(
      rayMul(
        ctxtAfterDeposit.userStaticATokenBalance.toString(),
        ctxtAfterWithdrawal.currentRate.toString()
      ).toString()
    )
    expect(ctxtAfterWithdrawal.userStaticATokenBalance).to.be.eq(0)
  })

  it('Deposit aWETH on stataWETH and then withdraw some balance in aToken', async () => {
    const amountToDeposit = utils.parseEther('5')
    const amountToWithdraw = utils.parseEther('2.5')

    // Preparation
    await waitForTx(await weth.deposit({ value: amountToDeposit }))
    await waitForTx(await weth.approve(lendingPool.address, amountToDeposit, defaultTxParams))
    await waitForTx(
      await lendingPool.deposit(
        weth.address,
        amountToDeposit,
        userSigner._address,
        0,
        defaultTxParams
      )
    )
    const ctxtInitial = await getContext(ctxtParams)
    await waitForTx(await aweth.approve(staticAToken.address, amountToDeposit, defaultTxParams))

    // Deposit
    await waitForTx(
      await staticAToken.deposit(userSigner._address, amountToDeposit, 0, false, defaultTxParams)
    )

    const ctxtAfterDeposit = await getContext(ctxtParams)

    // Withdraw
    await waitForTx(
      await staticAToken.withdraw(userSigner._address, amountToWithdraw, false, defaultTxParams)
    )

    const ctxtAfterWithdrawal = await getContext(ctxtParams)

    expect(ctxtInitial.userStaticATokenBalance).to.be.eq(0)
    expect(ctxtInitial.userATokenBalance).to.eq(amountToDeposit)
    expect(ctxtInitial.staticATokenSupply).to.be.eq(0)
    expect(ctxtInitial.staticATokenUnderlyingBalance).to.be.eq(0)

    expect(ctxtAfterDeposit.userDynamicStaticATokenBalance).to.be.eq(
      ctxtAfterDeposit.staticATokenATokenBalance
    )
    expect(ctxtAfterDeposit.userStaticATokenBalance).to.be.eq(ctxtAfterDeposit.staticATokenSupply)
    expect(ctxtAfterDeposit.staticATokenATokenBalance).to.be.eq(amountToDeposit)

    expect(ctxtAfterWithdrawal.userStaticATokenBalance).to.be.eq(
      ctxtAfterDeposit.userStaticATokenBalance.sub(amountToWithdraw)
    )

    expect(ctxtAfterWithdrawal.userDynamicStaticATokenBalance).to.be.eq(
      BigNumber.from(
        rayMul(
          new bnjs(ctxtAfterDeposit.userStaticATokenBalance.sub(amountToWithdraw).toString()),
          new bnjs(ctxtAfterWithdrawal.currentRate.toString())
        ).toString()
      )
    )

    expect(ctxtAfterWithdrawal.userATokenBalance).to.be.eq(
      BigNumber.from(
        rayMul(
          new bnjs(ctxtAfterDeposit.userScaledBalanceAToken.add(amountToWithdraw).toString()),
          new bnjs(ctxtAfterWithdrawal.currentRate.toString())
        ).toString()
      )
    )
  })

  it('Transfer with permit()', async () => {
    const amountToDeposit = utils.parseEther('5')

    // Just preparation
    await waitForTx(await weth.deposit({ value: amountToDeposit }))
    await waitForTx(await weth.approve(staticAToken.address, amountToDeposit, defaultTxParams))

    // Depositing
    await waitForTx(
      await staticAToken.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
    )

    const ctxtBeforeTransfer = await getContext(ctxtParams)

    const owner = user1
    const spender = user2

    const tokenName = await staticAToken.name()

    const chainId = hre.network.config.chainId || 1
    const expiration = MAX_UINT256
    const nonce = (await staticAToken._nonces(owner.address)).toNumber()
    const permitAmount = ethers.utils.parseEther('2').toString()
    const msgParams = buildPermitParams(
      chainId,
      staticAToken.address,
      '1',
      tokenName,
      owner.address,
      spender.address,
      nonce,
      expiration.toString(),
      permitAmount
    )

    expect((await staticAToken.allowance(owner.address, spender.address)).toString()).to.be.equal(
      '0',
      'INVALID_ALLOWANCE_BEFORE_PERMIT'
    )

    const sig = await owner._signTypedData(msgParams.domain, msgParams.types, msgParams.message)
    const { v, r, s } = ethers.utils.splitSignature(sig)

    await expect(
      staticAToken
        .connect(spender)
        .permit(spender.address, spender.address, permitAmount, expiration, v, r, s)
    ).to.be.revertedWith(LM_ERRORS.INVALID_SIGNATURE)

    await waitForTx(
      await staticAToken
        .connect(spender)
        .permit(owner.address, spender.address, permitAmount, expiration, v, r, s)
    )

    expect((await staticAToken.allowance(owner.address, spender.address)).toString()).to.be.equal(
      permitAmount,
      'INVALID_ALLOWANCE_AFTER_PERMIT'
    )

    await waitForTx(
      await staticAToken.connect(spender).transferFrom(owner.address, spender.address, permitAmount)
    )

    const ctxtAfterTransfer = await getContext(ctxtParams)

    expect(ctxtAfterTransfer.user2StaticATokenBalance).to.be.eq(
      ctxtBeforeTransfer.user2StaticATokenBalance.add(permitAmount)
    )
    expect(ctxtAfterTransfer.userStaticATokenBalance).to.be.eq(
      ctxtBeforeTransfer.userStaticATokenBalance.sub(permitAmount)
    )
  })

  it('Transfer with permit() (expect fail)', async () => {
    const amountToDeposit = utils.parseEther('5')

    // Just preparation
    await waitForTx(await weth.deposit({ value: amountToDeposit }))
    await waitForTx(await weth.approve(staticAToken.address, amountToDeposit, defaultTxParams))

    // Depositing
    await waitForTx(
      await staticAToken.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
    )

    const owner = user1
    const spender = user2

    const tokenName = await staticAToken.name()

    const chainId = hre.network.config.chainId || 1
    const expiration = 0
    const nonce = (await staticAToken._nonces(owner.address)).toNumber()
    const permitAmount = ethers.utils.parseEther('2').toString()
    const msgParams = buildPermitParams(
      chainId,
      staticAToken.address,
      '1',
      tokenName,
      owner.address,
      spender.address,
      nonce,
      expiration.toFixed(),
      permitAmount
    )

    expect((await staticAToken.allowance(owner.address, spender.address)).toString()).to.be.equal(
      '0',
      'INVALID_ALLOWANCE_BEFORE_PERMIT'
    )

    const sig = await owner._signTypedData(msgParams.domain, msgParams.types, msgParams.message)
    const { v, r, s } = ethers.utils.splitSignature(sig)

    await expect(
      staticAToken
        .connect(spender)
        .permit(ZERO_ADDRESS, spender.address, permitAmount, expiration, v, r, s)
    ).to.be.revertedWith(LM_ERRORS.INVALID_OWNER)

    await expect(
      staticAToken
        .connect(spender)
        .permit(owner.address, spender.address, permitAmount, expiration, v, r, s)
    ).to.be.revertedWith(LM_ERRORS.INVALID_EXPIRATION)

    expect((await staticAToken.allowance(owner.address, spender.address)).toString()).to.be.equal(
      '0',
      'INVALID_ALLOWANCE_AFTER_PERMIT'
    )
  })

  it('Deposit using metaDeposit()', async () => {
    const amountToDeposit = utils.parseEther('5')
    const chainId = hre.network.config.chainId ? hre.network.config.chainId : 1

    const domain = {
      name: await staticAToken.name(),
      version: '1',
      chainId: chainId,
      verifyingContract: staticAToken.address,
    }
    const domainSeperator = _TypedDataEncoder.hashDomain(domain)
    const seperator = await staticAToken.getDomainSeparator()
    expect(seperator).to.be.eq(domainSeperator)

    // Preparation
    await waitForTx(await weth.deposit({ value: amountToDeposit }))
    await waitForTx(await weth.approve(staticAToken.address, amountToDeposit, defaultTxParams))

    const tokenName = await staticAToken.name()
    const nonce = (await staticAToken._nonces(userSigner._address)).toNumber()
    const value = amountToDeposit.toString()
    const referralCode = 0
    const depositor = userSigner._address
    const recipient = userSigner._address
    const fromUnderlying = true
    const deadline = MAX_UINT256

    const user = user1

    const msgParams = buildMetaDepositParams(
      chainId,
      staticAToken.address,
      '1',
      tokenName,
      depositor,
      recipient,
      referralCode,
      fromUnderlying,
      nonce,
      deadline.toString(),
      value
    )

    const sig = await user._signTypedData(msgParams.domain, msgParams.types, msgParams.message)
    const { v, r, s } = ethers.utils.splitSignature(sig)

    const sigParams = {
      v,
      r,
      s,
    }

    const ctxtInitial = await getContext(ctxtParams)

    await expect(
      staticAToken
        .connect(user2Signer)
        .metaDeposit(
          ZERO_ADDRESS,
          recipient,
          value,
          referralCode,
          fromUnderlying,
          deadline,
          sigParams
        )
    ).to.be.revertedWith(LM_ERRORS.INVALID_DEPOSITOR)

    await expect(
      staticAToken
        .connect(user2Signer)
        .metaDeposit(depositor, recipient, value, referralCode, fromUnderlying, 0, sigParams)
    ).to.be.revertedWith(LM_ERRORS.INVALID_EXPIRATION)

    await expect(
      staticAToken
        .connect(user2Signer)
        .metaDeposit(
          user2Signer._address,
          recipient,
          value,
          referralCode,
          fromUnderlying,
          deadline,
          sigParams
        )
    ).to.be.revertedWith(LM_ERRORS.INVALID_SIGNATURE)

    // Deposit
    await waitForTx(
      await staticAToken
        .connect(user2Signer)
        .metaDeposit(depositor, recipient, value, referralCode, fromUnderlying, deadline, sigParams)
    )

    const ctxtAfterDeposit = await getContext(ctxtParams)

    expect(ctxtInitial.userStaticATokenBalance).to.be.eq(0)
    expect(ctxtAfterDeposit.userStaticATokenBalance).to.be.eq(
      BigNumber.from(rayDiv(value.toString(), ctxtAfterDeposit.currentRate.toString()).toString())
    )
    expect(ctxtAfterDeposit.userDynamicStaticATokenBalance).to.be.eq(value)
  })

  it('Withdraw using withdrawDynamicAmount()', async () => {
    const amountToDeposit = utils.parseEther('5')
    const amountToWithdraw = utils.parseEther('1')

    // Preparation
    await waitForTx(await weth.deposit({ value: amountToDeposit }))
    await waitForTx(await weth.approve(staticAToken.address, amountToDeposit, defaultTxParams))

    // Deposit
    await waitForTx(
      await staticAToken.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
    )

    const ctxtBeforeWithdrawal = await getContext(ctxtParams)

    // Withdraw dynamic amount
    await waitForTx(
      await staticAToken.withdrawDynamicAmount(
        userSigner._address,
        amountToWithdraw,
        false,
        defaultTxParams
      )
    )

    const ctxtAfterWithdrawal = await getContext(ctxtParams)

    expect(ctxtBeforeWithdrawal.userATokenBalance).to.be.eq(0)
    expect(ctxtBeforeWithdrawal.staticATokenATokenBalance).to.be.closeTo(amountToDeposit, 2)
    expect(ctxtAfterWithdrawal.userATokenBalance).to.be.closeTo(amountToWithdraw, 2)
    expect(ctxtAfterWithdrawal.userDynamicStaticATokenBalance).to.be.closeTo(
      BigNumber.from(
        rayMul(
          new bnjs(ctxtBeforeWithdrawal.userStaticATokenBalance.toString()),
          new bnjs(ctxtAfterWithdrawal.currentRate.toString())
        ).toString()
      ).sub(amountToWithdraw),
      2
    )

    expect(ctxtAfterWithdrawal.userStkAaveBalance).to.be.eq(0)
  })

  it('Withdraw using metaWithdraw()', async () => {
    const amountToDeposit = utils.parseEther('5')
    const chainId = hre.network.config.chainId ? hre.network.config.chainId : 1

    const domain = {
      name: await staticAToken.name(),
      version: '1',
      chainId: chainId,
      verifyingContract: staticAToken.address,
    }
    const domainSeperator = _TypedDataEncoder.hashDomain(domain)
    const seperator = await staticAToken.getDomainSeparator()
    expect(seperator).to.be.eq(domainSeperator)

    // Preparation
    await waitForTx(await weth.deposit({ value: amountToDeposit }))
    await waitForTx(await weth.approve(staticAToken.address, amountToDeposit, defaultTxParams))

    // Deposit
    await waitForTx(
      await staticAToken.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
    )

    // Meta withdraw
    const user = user1
    const tokenName = await staticAToken.name()
    const nonce = (await staticAToken._nonces(userSigner._address)).toNumber()
    const owner = userSigner._address
    const recipient = userSigner._address
    const staticAmount = (await staticAToken.balanceOf(userSigner._address)).toString()
    const dynamicAmount = '0'
    const toUnderlying = true
    const deadline = MAX_UINT256 // (await timeLatest()).plus(60 * 60).toFixed();

    const msgParams = buildMetaWithdrawParams(
      chainId,
      staticAToken.address,
      '1',
      tokenName,
      owner,
      recipient,
      staticAmount,
      dynamicAmount,
      toUnderlying,
      nonce,
      deadline.toString()
    )

    const sig = await user._signTypedData(msgParams.domain, msgParams.types, msgParams.message)
    const { v, r, s } = ethers.utils.splitSignature(sig)

    const sigParams = {
      v,
      r,
      s,
    }

    const ctxtInitial = await getContext(ctxtParams)

    await expect(
      staticAToken
        .connect(user2Signer)
        .metaWithdraw(
          ZERO_ADDRESS,
          recipient,
          staticAmount,
          dynamicAmount,
          toUnderlying,
          deadline,
          sigParams
        )
    ).to.be.revertedWith(LM_ERRORS.INVALID_OWNER)

    await expect(
      staticAToken
        .connect(user2Signer)
        .metaWithdraw(owner, recipient, staticAmount, dynamicAmount, toUnderlying, 0, sigParams)
    ).to.be.revertedWith(LM_ERRORS.INVALID_EXPIRATION)

    await expect(
      staticAToken
        .connect(user2Signer)
        .metaWithdraw(
          user2Signer._address,
          recipient,
          staticAmount,
          dynamicAmount,
          toUnderlying,
          deadline,
          sigParams
        )
    ).to.be.revertedWith(LM_ERRORS.INVALID_SIGNATURE)

    // Deposit
    await waitForTx(
      await staticAToken
        .connect(user2Signer)
        .metaWithdraw(
          owner,
          recipient,
          staticAmount,
          dynamicAmount,
          toUnderlying,
          deadline,
          sigParams
        )
    )

    const ctxtAfterWithdrawal = await getContext(ctxtParams)

    expect(ctxtInitial.userDynamicStaticATokenBalance).to.be.eq(amountToDeposit)
    expect(ctxtAfterWithdrawal.userStaticATokenBalance).to.be.eq(0)
    expect(ctxtAfterWithdrawal.userDynamicStaticATokenBalance).to.be.eq(0)
  })

  it('Withdraw using metaWithdraw() (expect to fail)', async () => {
    const amountToDeposit = utils.parseEther('5')
    const chainId = hre.network.config.chainId ? hre.network.config.chainId : 1

    const domain = {
      name: await staticAToken.name(),
      version: '1',
      chainId: chainId,
      verifyingContract: staticAToken.address,
    }
    const domainSeperator = _TypedDataEncoder.hashDomain(domain)
    const seperator = await staticAToken.getDomainSeparator()
    expect(seperator).to.be.eq(domainSeperator)

    const user = user1

    // Preparation
    await waitForTx(await weth.deposit({ value: amountToDeposit }))
    await waitForTx(await weth.approve(staticAToken.address, amountToDeposit, defaultTxParams))

    // Deposit
    await waitForTx(
      await staticAToken.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
    )

    // Meta withdraw
    const tokenName = await staticAToken.name()
    const nonce = (await staticAToken._nonces(userSigner._address)).toNumber()
    const owner = userSigner._address
    const recipient = userSigner._address
    const staticAmount = (await staticAToken.balanceOf(userSigner._address)).toString()
    const dynamicAmount = (
      await await staticAToken.dynamicBalanceOf(userSigner._address)
    ).toString()
    const toUnderlying = true
    const deadline = MAX_UINT256

    const msgParams = buildMetaWithdrawParams(
      chainId,
      staticAToken.address,
      '1',
      tokenName,
      owner,
      recipient,
      staticAmount,
      dynamicAmount,
      toUnderlying,
      nonce,
      deadline.toString()
    )

    const sig = await user._signTypedData(msgParams.domain, msgParams.types, msgParams.message)
    const { v, r, s } = ethers.utils.splitSignature(sig)

    const sigParams = {
      v,
      r,
      s,
    }

    const ctxtInitial = await getContext(ctxtParams)

    await expect(
      staticAToken
        .connect(user2Signer)
        .metaWithdraw(
          owner,
          recipient,
          staticAmount,
          dynamicAmount,
          toUnderlying,
          deadline,
          sigParams
        )
    ).to.be.revertedWith(LM_ERRORS.ONLY_ONE_AMOUNT_FORMAT_ALLOWED)

    const ctxtAfterDeposit = await getContext(ctxtParams)
    expect(ctxtInitial.userStaticATokenBalance).to.be.eq(ctxtAfterDeposit.userStaticATokenBalance)
  })

  it('Deposit WETH on stataWETH, then transfer and withdraw of the whole balance in underlying, finally claim', async () => {
    const amountToDeposit = utils.parseEther('5')
    const amountToWithdraw = MAX_UINT256

    // Preparation
    await waitForTx(await weth.deposit({ value: amountToDeposit }))
    await waitForTx(await weth.approve(staticAToken.address, amountToDeposit, defaultTxParams))

    const ctxtInitial = await getContext(ctxtParams)

    // Deposit
    await waitForTx(
      await staticAToken.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
    )

    const ctxtAfterDeposit = await getContext(ctxtParams)
    // Transfer staticATokens to other user
    await waitForTx(
      await staticAToken.transfer(user2Signer._address, ctxtAfterDeposit.userStaticATokenBalance)
    )

    const ctxtAfterTransfer = await getContext(ctxtParams)

    // Withdraw
    await waitForTx(
      await staticAToken
        .connect(user2Signer)
        .withdraw(user2Signer._address, amountToWithdraw, true, defaultTxParams)
    )

    const ctxtAfterWithdrawal = await getContext(ctxtParams)

    // Claim
    await waitForTx(
      await staticAToken.connect(user2Signer).claimRewards(user2Signer._address, true)
    )
    const ctxtAfterClaim = await getContext(ctxtParams)

    // Checks
    expect(ctxtAfterDeposit.staticATokenATokenBalance).to.be.eq(
      ctxtInitial.staticATokenATokenBalance.add(amountToDeposit)
    )
    expect(ctxtAfterDeposit.userUnderlyingBalance).to.be.eq(
      ctxtInitial.userUnderlyingBalance.sub(amountToDeposit)
    )
    expect(ctxtAfterTransfer.user2StaticATokenBalance).to.be.eq(
      ctxtAfterDeposit.userStaticATokenBalance
    )
    expect(ctxtAfterTransfer.userStaticATokenBalance).to.be.eq(0)
    expect(ctxtAfterTransfer.userPendingRewards).to.be.eq(0)
    expect(ctxtAfterTransfer.user2PendingRewards).to.be.gt(0)
    expect(ctxtAfterWithdrawal.staticATokenSupply).to.be.eq(0)
    expect(ctxtAfterWithdrawal.staticATokenATokenBalance).to.be.eq(0)
    expect(ctxtAfterWithdrawal.userPendingRewards).to.be.eq(0)
    expect(ctxtAfterWithdrawal.staticATokenTotalClaimableRewards).to.be.gte(
      ctxtAfterWithdrawal.user2PendingRewards
    )

    expect(ctxtAfterClaim.userStkAaveBalance).to.be.eq(0)
    expect(ctxtAfterClaim.user2StkAaveBalance).to.be.eq(ctxtAfterWithdrawal.user2PendingRewards)
    expect(ctxtAfterClaim.staticATokenStkAaveBalance).to.be.eq(
      ctxtAfterWithdrawal.staticATokenTotalClaimableRewards.sub(
        ctxtAfterWithdrawal.user2PendingRewards
      )
    )
    // Expect dust to be left in the contract
    expect(ctxtAfterClaim.staticATokenStkAaveBalance).to.be.lt(5)
  })

  it('Deposit WETH on stataWETH, then transfer and withdraw of the whole balance in underlying, finally claimToSelf', async () => {
    const amountToDeposit = utils.parseEther('5')
    const amountToWithdraw = MAX_UINT256

    // Preparation
    await waitForTx(await weth.deposit({ value: amountToDeposit }))
    await waitForTx(await weth.approve(staticAToken.address, amountToDeposit, defaultTxParams))

    const ctxtInitial = await getContext(ctxtParams)

    // Deposit
    await waitForTx(
      await staticAToken.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
    )

    const ctxtAfterDeposit = await getContext(ctxtParams)
    // Transfer staticATokens to other user
    await waitForTx(
      await staticAToken.transfer(user2Signer._address, ctxtAfterDeposit.userStaticATokenBalance)
    )

    const ctxtAfterTransfer = await getContext(ctxtParams)

    // Withdraw
    await waitForTx(
      await staticAToken
        .connect(user2Signer)
        .withdraw(user2Signer._address, amountToWithdraw, true, defaultTxParams)
    )

    const ctxtAfterWithdrawal = await getContext(ctxtParams)

    // Claim
    await waitForTx(await staticAToken.connect(user2Signer).claimRewardsToSelf(true))
    const ctxtAfterClaim = await getContext(ctxtParams)

    // Checks
    expect(ctxtAfterDeposit.staticATokenATokenBalance).to.be.eq(
      ctxtInitial.staticATokenATokenBalance.add(amountToDeposit)
    )
    expect(ctxtAfterDeposit.userUnderlyingBalance).to.be.eq(
      ctxtInitial.userUnderlyingBalance.sub(amountToDeposit)
    )
    expect(ctxtAfterTransfer.user2StaticATokenBalance).to.be.eq(
      ctxtAfterDeposit.userStaticATokenBalance
    )
    expect(ctxtAfterTransfer.userStaticATokenBalance).to.be.eq(0)
    expect(ctxtAfterTransfer.userPendingRewards).to.be.eq(0)
    expect(ctxtAfterTransfer.user2PendingRewards).to.be.gt(0)
    expect(ctxtAfterWithdrawal.staticATokenSupply).to.be.eq(0)
    expect(ctxtAfterWithdrawal.staticATokenATokenBalance).to.be.eq(0)
    expect(ctxtAfterWithdrawal.userPendingRewards).to.be.eq(0)
    expect(ctxtAfterWithdrawal.staticATokenTotalClaimableRewards).to.be.gte(
      ctxtAfterWithdrawal.user2PendingRewards
    )

    expect(ctxtAfterClaim.userStkAaveBalance).to.be.eq(0)
    expect(ctxtAfterClaim.user2StkAaveBalance).to.be.eq(ctxtAfterWithdrawal.user2PendingRewards)
    expect(ctxtAfterClaim.staticATokenStkAaveBalance).to.be.eq(
      ctxtAfterWithdrawal.staticATokenTotalClaimableRewards.sub(
        ctxtAfterWithdrawal.user2PendingRewards
      )
    )
    // Expect dust to be left in the contract
    expect(ctxtAfterClaim.staticATokenStkAaveBalance).to.be.lt(5)
  })

  it('Deposit WETH on stataWETH, then transfer and withdraw of the whole balance in underlying, finally someone claims on behalf', async () => {
    const amountToDeposit = utils.parseEther('5')
    const amountToWithdraw = MAX_UINT256

    const [, , claimer] = await hre.ethers.getSigners()
    const claimerSigner = hre.ethers.provider.getSigner(await claimer.getAddress())

    // Allow another use to claim on behalf of
    await whileImpersonating(AAVE_EMISSIONS_MGR_ADDRESS, async (emSigner) => {
      // Fund emissionManager
      const selfdestructContract: SelfdestructTransfer = <SelfdestructTransfer>(
        await (await ethers.getContractFactory('SelfdestructTransfer')).deploy()
      )
      // Selfdestruct the mock, pointing to WETHGateway address
      await selfdestructContract
        .connect(user2Signer)
        .destroyAndTransfer(emSigner.address, { value: parseEther('1') })

      await waitForTx(
        await incentives.connect(emSigner).setClaimer(user2Signer._address, claimerSigner._address)
      )
    })

    // Preparation
    await waitForTx(await weth.deposit({ value: amountToDeposit }))
    await waitForTx(await weth.approve(staticAToken.address, amountToDeposit, defaultTxParams))

    const ctxtInitial = await getContext(ctxtParams)
    // Deposit
    await waitForTx(
      await staticAToken.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
    )

    const ctxtAfterDeposit = await getContext(ctxtParams)
    // Transfer staticATokens to other user
    await waitForTx(
      await staticAToken.transfer(user2Signer._address, ctxtAfterDeposit.userStaticATokenBalance)
    )

    const ctxtAfterTransfer = await getContext(ctxtParams)

    // Withdraw
    await waitForTx(
      await staticAToken
        .connect(user2Signer)
        .withdraw(user2Signer._address, amountToWithdraw, true, defaultTxParams)
    )

    const ctxtAfterWithdrawal = await getContext(ctxtParams)

    // Claim
    await waitForTx(
      await staticAToken
        .connect(claimerSigner)
        .claimRewardsOnBehalf(user2Signer._address, user2Signer._address, true)
    )
    const ctxtAfterClaim = await getContext(ctxtParams)

    // Checks
    expect(ctxtAfterDeposit.staticATokenATokenBalance).to.be.eq(
      ctxtInitial.staticATokenATokenBalance.add(amountToDeposit)
    )
    expect(ctxtAfterDeposit.userUnderlyingBalance).to.be.eq(
      ctxtInitial.userUnderlyingBalance.sub(amountToDeposit)
    )
    expect(ctxtAfterTransfer.user2StaticATokenBalance).to.be.eq(
      ctxtAfterDeposit.userStaticATokenBalance
    )
    expect(ctxtAfterTransfer.userStaticATokenBalance).to.be.eq(0)
    expect(ctxtAfterTransfer.userPendingRewards).to.be.eq(0)
    expect(ctxtAfterTransfer.user2PendingRewards).to.be.gt(0)
    expect(ctxtAfterWithdrawal.staticATokenSupply).to.be.eq(0)
    expect(ctxtAfterWithdrawal.staticATokenATokenBalance).to.be.eq(0)
    expect(ctxtAfterWithdrawal.userPendingRewards).to.be.eq(0)
    expect(ctxtAfterWithdrawal.staticATokenTotalClaimableRewards).to.be.gte(
      ctxtAfterWithdrawal.user2PendingRewards
    )

    expect(ctxtAfterClaim.userStkAaveBalance).to.be.eq(0)
    expect(ctxtAfterClaim.user2StkAaveBalance).to.be.eq(ctxtAfterWithdrawal.user2PendingRewards)
    expect(ctxtAfterClaim.staticATokenStkAaveBalance).to.be.eq(
      ctxtAfterWithdrawal.staticATokenTotalClaimableRewards.sub(
        ctxtAfterWithdrawal.user2PendingRewards
      )
    )
    // Expect dust to be left in the contract
    expect(ctxtAfterClaim.staticATokenStkAaveBalance).to.be.lt(5)
  })

  it('Deposit WETH on stataWETH, then transfer and withdraw of the whole balance in underlying, finally someone NOT set as claimer claims on behalf (reverts)', async () => {
    const amountToDeposit = utils.parseEther('5')
    const amountToWithdraw = MAX_UINT256

    const [, , claimer] = await hre.ethers.getSigners()
    const claimerSigner = hre.ethers.provider.getSigner(await claimer.getAddress())

    // Preparation
    await waitForTx(await weth.deposit({ value: amountToDeposit }))
    await waitForTx(await weth.approve(staticAToken.address, amountToDeposit, defaultTxParams))

    // Deposit
    await waitForTx(
      await staticAToken.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
    )

    const ctxtAfterDeposit = await getContext(ctxtParams)
    // Transfer staticATokens to other user
    await waitForTx(
      await staticAToken.transfer(user2Signer._address, ctxtAfterDeposit.userStaticATokenBalance)
    )

    // Withdraw
    await waitForTx(
      await staticAToken
        .connect(user2Signer)
        .withdraw(user2Signer._address, amountToWithdraw, true, defaultTxParams)
    )

    // Claim
    await expect(
      staticAToken
        .connect(claimerSigner)
        .claimRewardsOnBehalf(user2Signer._address, user2Signer._address, true)
    ).to.be.revertedWith(LM_ERRORS.INVALID_CLAIMER)
  })

  it('Deposit WETH on stataWETH, then transfer and withdraw of the whole balance in underlying, finally claims on behalf of self', async () => {
    const amountToDeposit = utils.parseEther('5')
    const amountToWithdraw = MAX_UINT256

    // Preparation
    await waitForTx(await weth.deposit({ value: amountToDeposit }))
    await waitForTx(await weth.approve(staticAToken.address, amountToDeposit, defaultTxParams))

    const ctxtInitial = await getContext(ctxtParams)

    // Deposit
    await waitForTx(
      await staticAToken.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
    )

    const ctxtAfterDeposit = await getContext(ctxtParams)
    // Transfer staticATokens to other user
    await waitForTx(
      await staticAToken.transfer(user2Signer._address, ctxtAfterDeposit.userStaticATokenBalance)
    )

    const ctxtAfterTransfer = await getContext(ctxtParams)

    // Withdraw
    await waitForTx(
      await staticAToken
        .connect(user2Signer)
        .withdraw(user2Signer._address, amountToWithdraw, true, defaultTxParams)
    )

    const ctxtAfterWithdrawal = await getContext(ctxtParams)

    // Claim
    await waitForTx(
      await staticAToken
        .connect(user2Signer)
        .claimRewardsOnBehalf(user2Signer._address, user2Signer._address, true)
    )
    const ctxtAfterClaim = await getContext(ctxtParams)

    // Checks
    expect(ctxtAfterDeposit.staticATokenATokenBalance).to.be.eq(
      ctxtInitial.staticATokenATokenBalance.add(amountToDeposit)
    )
    expect(ctxtAfterDeposit.userUnderlyingBalance).to.be.eq(
      ctxtInitial.userUnderlyingBalance.sub(amountToDeposit)
    )
    expect(ctxtAfterTransfer.user2StaticATokenBalance).to.be.eq(
      ctxtAfterDeposit.userStaticATokenBalance
    )
    expect(ctxtAfterTransfer.userStaticATokenBalance).to.be.eq(0)
    expect(ctxtAfterTransfer.userPendingRewards).to.be.eq(0)
    expect(ctxtAfterTransfer.user2PendingRewards).to.be.gt(0)
    expect(ctxtAfterWithdrawal.staticATokenSupply).to.be.eq(0)
    expect(ctxtAfterWithdrawal.staticATokenATokenBalance).to.be.eq(0)
    expect(ctxtAfterWithdrawal.userPendingRewards).to.be.eq(0)
    expect(ctxtAfterWithdrawal.staticATokenTotalClaimableRewards).to.be.gte(
      ctxtAfterWithdrawal.user2PendingRewards
    )

    expect(ctxtAfterClaim.userStkAaveBalance).to.be.eq(0)
    expect(ctxtAfterClaim.user2StkAaveBalance).to.be.eq(ctxtAfterWithdrawal.user2PendingRewards)
    expect(ctxtAfterClaim.staticATokenStkAaveBalance).to.be.eq(
      ctxtAfterWithdrawal.staticATokenTotalClaimableRewards.sub(
        ctxtAfterWithdrawal.user2PendingRewards
      )
    )
    // Expect dust to be left in the contract
    expect(ctxtAfterClaim.staticATokenStkAaveBalance).to.be.lt(5)
  })
})
