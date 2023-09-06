import hre, { ethers } from 'hardhat'
import { expect } from 'chai'
import bnjs from 'bignumber.js'
import { formatEther, parseEther, _TypedDataEncoder } from 'ethers/lib/utils'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import forkBlockNumber from '../../../integration/fork-block-numbers'
import { whileImpersonating } from '../../../utils/impersonation'
import { advanceTime } from '../../../utils/time'
import {
  buildPermitParams,
  buildMetaDepositParams,
  buildMetaWithdrawParams,
  evmRevert,
  evmSnapshot,
  waitForTx,
} from '../../../integration/utils'
import { BigNumber, ContractFactory, providers, Signer, utils } from 'ethers'
import { rayDiv, rayMul } from '../../../integration/ray-math'
import { getChainId } from '../../../../common/blockchain-utils'
import { networkConfig } from '../../../../common/configuration'
import { MAX_UINT256, ZERO_ADDRESS } from '../../../../common/constants'
import {
  ATokenNoController,
  ERC20Mock,
  IAaveIncentivesController,
  IAToken,
  ILendingPool,
  IWETH,
  SelfdestructTransfer,
  StaticATokenLM,
} from '../../../../typechain'
import { useEnv } from '#/utils/env'

let chainId: number

// Setup test environment
const setup = async (blockNumber: number) => {
  // Use Mainnet fork
  await hre.network.provider.request({
    method: 'hardhat_reset',
    params: [
      {
        forking: {
          jsonRpcUrl: useEnv('MAINNET_RPC_URL'),
          blockNumber: blockNumber,
        },
      },
    ],
  })
}

const getUserData = async (
  _users: Signer[],
  _debug = false,
  staticAToken: StaticATokenLM,
  stkAave: ERC20Mock
) => {
  const usersData: {
    pendingRewards: BigNumber
    stkAaveBalance: BigNumber
    staticBalance: BigNumber
  }[] = []
  if (_debug) {
    console.log(`Printing user data:`)
  }
  for (let i = 0; i < _users.length; i++) {
    const userAddress = await _users[i].getAddress()
    usersData.push({
      pendingRewards: await staticAToken.getClaimableRewards(userAddress),
      stkAaveBalance: await stkAave.balanceOf(userAddress),
      staticBalance: await staticAToken.balanceOf(userAddress),
    })
    if (_debug) {
      console.log(
        `\tUser ${i} pendingRewards: ${formatEther(
          usersData[i].pendingRewards
        )}, stkAave balance: ${formatEther(usersData[i].stkAaveBalance)}, static bal: ${formatEther(
          usersData[i].staticBalance
        )} `
      )
    }
  }
  return usersData
}

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
  currentRate: await lendingPool.getReserveNormalizedIncome(
    networkConfig[chainId].tokens.WETH || ''
  ),
  staticATokenSupply: await staticAToken.totalSupply(),
})

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork('StaticATokenLM: aToken wrapper with static balances and liquidity mining', () => {
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

    chainId = await getChainId(hre)
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }

    userSigner = hre.ethers.provider.getSigner(await user1.getAddress())
    user2Signer = hre.ethers.provider.getSigner(await user2.getAddress())

    lendingPool = <ILendingPool>(
      await ethers.getContractAt(
        'ILendingPool',
        networkConfig[chainId].AAVE_LENDING_POOL || '',
        userSigner
      )
    )
    incentives = <IAaveIncentivesController>(
      await ethers.getContractAt(
        'contracts/plugins/assets/aave/vendor/IAaveIncentivesController.sol:IAaveIncentivesController',
        networkConfig[chainId].AAVE_INCENTIVES || '',
        userSigner
      )
    )

    weth = <IWETH>(
      await ethers.getContractAt('IWETH', networkConfig[chainId].tokens.WETH || '', userSigner)
    )
    aweth = <IAToken>(
      await ethers.getContractAt(
        'contracts/plugins/assets/aave/vendor/IAToken.sol:IAToken',
        networkConfig[chainId].tokens.aWETH || '',
        userSigner
      )
    )
    stkAave = <ERC20Mock>(
      await ethers.getContractAt(
        'ERC20Mock',
        networkConfig[chainId].tokens.stkAAVE || '',
        userSigner
      )
    )

    const StaticATokenFactory: ContractFactory = await ethers.getContractFactory('StaticATokenLM')

    staticAToken = <StaticATokenLM>(
      await StaticATokenFactory.connect(userSigner).deploy(
        networkConfig[chainId].AAVE_LENDING_POOL,
        networkConfig[chainId].tokens.aWETH,
        'Static Aave Interest Bearing WETH',
        'stataWETH'
      )
    )

    expect(await staticAToken.getIncentivesController()).to.be.eq(
      networkConfig[chainId].AAVE_INCENTIVES
    )

    expect(await staticAToken.UNDERLYING_ASSET_ADDRESS()).to.be.eq(weth.address)

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
    await waitForTx(
      await staticAToken
        .connect(userSigner)
        ['claimRewards(address,bool)'](userSigner._address, false)
    )

    const ctxtAfterClaimNoForce = await getContext(ctxtParams)

    await waitForTx(
      await staticAToken
        .connect(userSigner)
        ['claimRewards(address,bool)'](userSigner._address, true)
    )

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

    // Withdraw
    await waitForTx(
      await staticAToken.withdraw(userSigner._address, amountToWithdraw, true, defaultTxParams)
    )
    const ctxtAfterWithdrawal = await getContext(ctxtParams)

    // Claim
    await waitForTx(
      await staticAToken
        .connect(userSigner)
        ['claimRewards(address,bool)'](userSigner._address, false)
    )
    const ctxtAfterClaim = await getContext(ctxtParams)

    await waitForTx(await staticAToken.collectAndUpdateRewards())
    const ctxtAfterUpdate = await getContext(ctxtParams)

    await waitForTx(
      await staticAToken
        .connect(userSigner)
        ['claimRewards(address,bool)'](userSigner._address, false)
    )
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

  it('Withdraw using withdrawDynamicAmount() - exceeding balance', async () => {
    const amountToDeposit = utils.parseEther('5')
    // Exceed available balance
    const amountToWithdraw = utils.parseEther('10')

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
    // Withdraws all balance
    expect(ctxtAfterWithdrawal.userATokenBalance).to.be.closeTo(
      BigNumber.from(
        rayMul(
          new bnjs(ctxtBeforeWithdrawal.userStaticATokenBalance.toString()),
          new bnjs(ctxtAfterWithdrawal.currentRate.toString())
        ).toString()
      ),
      2
    )
    expect(ctxtAfterWithdrawal.userDynamicStaticATokenBalance).to.equal(0)
    expect(ctxtAfterWithdrawal.userStkAaveBalance).to.equal(0)
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
      await staticAToken
        .connect(user2Signer)
        ['claimRewards(address,bool)'](user2Signer._address, true)
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
    await whileImpersonating(
      networkConfig[chainId].AAVE_EMISSIONS_MGR as string,
      async (emSigner) => {
        // Fund emissionManager
        const selfdestructContract: SelfdestructTransfer = <SelfdestructTransfer>(
          await (await ethers.getContractFactory('SelfdestructTransfer')).deploy()
        )
        // Selfdestruct the mock, pointing to WETHGateway address
        await selfdestructContract
          .connect(user2Signer)
          .destroyAndTransfer(emSigner.address, { value: parseEther('1') })

        await waitForTx(
          await incentives
            .connect(emSigner)
            .setClaimer(user2Signer._address, claimerSigner._address)
        )
      }
    )

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

  describe('Rewards - Small checks', () => {
    it('Rewards increase at deposit, update and withdraw and set to 0 at claim', async () => {
      const amountToDeposit = utils.parseEther('5')
      const amountToWithdraw = MAX_UINT256

      // Just preparation
      await waitForTx(await weth.deposit({ value: amountToDeposit.mul(2) }))
      await waitForTx(
        await weth.approve(staticAToken.address, amountToDeposit.mul(2), defaultTxParams)
      )

      // Depositing
      await waitForTx(
        await staticAToken.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
      )

      const pendingRewards1 = await staticAToken.getClaimableRewards(userSigner._address)

      // Depositing
      await waitForTx(
        await staticAToken.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
      )

      const pendingRewards2 = await staticAToken.getClaimableRewards(userSigner._address)

      await waitForTx(await staticAToken.collectAndUpdateRewards())

      const pendingRewards3 = await staticAToken.getClaimableRewards(userSigner._address)

      // Withdrawing all.
      await waitForTx(
        await staticAToken.withdraw(userSigner._address, amountToWithdraw, true, defaultTxParams)
      )

      const pendingRewards4 = await staticAToken.getClaimableRewards(userSigner._address)
      const totPendingRewards4 = await staticAToken.getTotalClaimableRewards()
      const claimedRewards4 = await stkAave.balanceOf(userSigner._address)
      const stkAaveStatic4 = await stkAave.balanceOf(staticAToken.address)

      await waitForTx(await staticAToken.connect(userSigner).claimRewardsToSelf(false))

      const pendingRewards5 = await staticAToken.getClaimableRewards(userSigner._address)
      const totPendingRewards5 = await staticAToken.getTotalClaimableRewards()
      const claimedRewards5 = await stkAave.balanceOf(userSigner._address)
      const stkAaveStatic5 = await stkAave.balanceOf(staticAToken.address)

      await waitForTx(await staticAToken.collectAndUpdateRewards())
      const pendingRewards6 = await staticAToken.getClaimableRewards(userSigner._address)

      // Checks
      expect(pendingRewards2).to.be.gt(pendingRewards1)
      expect(pendingRewards3).to.be.gt(pendingRewards2)
      expect(pendingRewards4).to.be.gt(pendingRewards3)
      expect(totPendingRewards4).to.be.gte(pendingRewards4)
      expect(pendingRewards5).to.be.eq(0) // User "sacrifice" excess rewards to save on gas-costs
      expect(pendingRewards6).to.be.eq(0)
      expect(claimedRewards4).to.be.eq(0)

      // Expect the user to have withdrawn everything.
      expect(claimedRewards5).to.be.eq(stkAaveStatic4)
      expect(stkAaveStatic5).to.be.eq(0)
      expect(totPendingRewards5).to.be.gt(0)
    })

    it('Check getters', async () => {
      const amountToDeposit = utils.parseEther('5')

      const accRewardsPerTokenPre = await staticAToken.getAccRewardsPerToken()
      const lifetimeRewardsClaimedPre = await staticAToken.getLifetimeRewardsClaimed()
      const lifetimeRewards = await staticAToken.getLifetimeRewards()
      const lastRewardBlock = await staticAToken.getLastRewardBlock()

      // Just preparation
      await waitForTx(await weth.deposit({ value: amountToDeposit.mul(2) }))
      await waitForTx(
        await weth.approve(staticAToken.address, amountToDeposit.mul(2), defaultTxParams)
      )

      // Depositing
      await waitForTx(
        await staticAToken.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
      )

      const staticBalance = await staticAToken.balanceOf(userSigner._address)
      const dynamicBalance = await staticAToken.dynamicBalanceOf(userSigner._address)

      const dynamicBalanceFromStatic = await staticAToken.staticToDynamicAmount(staticBalance)
      const staticBalanceFromDynamic = await staticAToken.dynamicToStaticAmount(dynamicBalance)

      expect(staticBalance).to.be.eq(staticBalanceFromDynamic)
      expect(dynamicBalance).to.be.eq(dynamicBalanceFromStatic)

      await staticAToken.collectAndUpdateRewards()

      expect(await staticAToken.getAccRewardsPerToken()).to.be.gt(accRewardsPerTokenPre)
      expect(await staticAToken.getLifetimeRewardsClaimed()).to.be.gt(lifetimeRewardsClaimedPre)
      expect(await staticAToken.getLifetimeRewards()).to.be.gt(lifetimeRewards)
      expect(await staticAToken.getLastRewardBlock()).to.be.gt(lastRewardBlock)
    })

    it('Multiple deposits in one block (Breaks if GasReport enabled)', async () => {
      const amountToDeposit = utils.parseEther('5')

      // Just preparation
      await waitForTx(await weth.deposit({ value: amountToDeposit.mul(2) }))
      await waitForTx(
        await weth.approve(staticAToken.address, amountToDeposit.mul(2), defaultTxParams)
      )

      await hre.network.provider.send('evm_setAutomine', [false])

      // Depositing
      const a = await staticAToken.deposit(
        userSigner._address,
        amountToDeposit,
        0,
        true,
        defaultTxParams
      )

      // Depositing
      const b = await staticAToken.deposit(
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
        await weth.approve(staticAToken.address, amountToDeposit.mul(2), defaultTxParams)
      )

      // Depositing
      await waitForTx(
        await staticAToken.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
      )

      await hre.network.provider.send('evm_setAutomine', [false])

      const a = await staticAToken.collectAndUpdateRewards()
      const b = await staticAToken.collectAndUpdateRewards()

      await hre.network.provider.send('evm_mine', [])

      const aReceipt = await hre.network.provider.send('eth_getTransactionReceipt', [a.hash])
      const bReceipt = await hre.network.provider.send('eth_getTransactionReceipt', [b.hash])

      const aGas = BigNumber.from(aReceipt['gasUsed'])
      const bGas = BigNumber.from(bReceipt['gasUsed'])

      expect(aGas).to.be.gt(350000)
      expect(bGas).to.be.lt(100000)

      await hre.network.provider.send('evm_setAutomine', [true])
    })

    it('Update and claim', async () => {
      const amountToDeposit = utils.parseEther('5')

      // Just preparation
      await waitForTx(await weth.deposit({ value: amountToDeposit.mul(2) }))
      await waitForTx(
        await weth.approve(staticAToken.address, amountToDeposit.mul(2), defaultTxParams)
      )

      // Depositing
      await waitForTx(
        await staticAToken.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
      )

      const pendingRewards1 = await staticAToken.getClaimableRewards(userSigner._address)

      // Depositing
      await waitForTx(
        await staticAToken.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
      )

      const pendingRewards2 = await staticAToken.getClaimableRewards(userSigner._address)

      await waitForTx(await staticAToken.collectAndUpdateRewards())

      const pendingRewards3 = await staticAToken.getClaimableRewards(userSigner._address)
      const claimedRewards3 = await stkAave.balanceOf(userSigner._address)

      await waitForTx(await staticAToken.connect(userSigner).claimRewardsToSelf(true))

      const pendingRewards4 = await staticAToken.getClaimableRewards(userSigner._address)
      const claimedRewards4 = await stkAave.balanceOf(userSigner._address)

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
        await weth.approve(staticAToken.address, amountToDeposit.mul(2), defaultTxParams)
      )

      // Depositing
      await waitForTx(
        await staticAToken.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
      )

      const userPendingRewards1 = await staticAToken.getClaimableRewards(userSigner._address)
      const recipientPendingRewards1 = await staticAToken.getClaimableRewards(recipient)

      // Withdrawing all
      await waitForTx(
        await staticAToken.withdraw(recipient, amountToWithdraw, true, defaultTxParams)
      )

      const userPendingRewards2 = await staticAToken.getClaimableRewards(userSigner._address)
      const recipientPendingRewards2 = await staticAToken.getClaimableRewards(recipient)

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
        await weth.approve(staticAToken.address, amountToDeposit.mul(2), defaultTxParams)
      )

      // Depositing
      await waitForTx(
        await staticAToken.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
      )

      const pendingRewards1 = await staticAToken.getClaimableRewards(userSigner._address)

      await advanceTime(60 * 60)

      const pendingRewards2 = await staticAToken.getClaimableRewards(userSigner._address)

      // Withdrawing all.
      await waitForTx(
        await staticAToken.withdraw(userSigner._address, amountToWithdraw, true, defaultTxParams)
      )

      // How will my pending look now
      const pendingRewards3 = await staticAToken.getClaimableRewards(userSigner._address)

      await waitForTx(await staticAToken.connect(userSigner).claimRewardsToSelf(true))

      const pendingRewards4 = await staticAToken.getClaimableRewards(userSigner._address)
      const userBalance4 = await stkAave.balanceOf(userSigner._address)

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
        await weth.approve(staticAToken.address, amountToDeposit.mul(2), defaultTxParams)
      )

      // Depositing
      await waitForTx(
        await staticAToken.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
      )

      const pendingRewards1 = await staticAToken.getClaimableRewards(userSigner._address)

      await advanceTime(60 * 60)

      const pendingRewards2 = await staticAToken.getClaimableRewards(userSigner._address)

      // Withdrawing all.
      await waitForTx(
        await staticAToken.withdraw(userSigner._address, amountToWithdraw, true, defaultTxParams)
      )

      // How will my pending look now
      const pendingRewards3 = await staticAToken.getClaimableRewards(userSigner._address)

      const userBalance3 = await stkAave.balanceOf(userSigner._address)
      await staticAToken
        .connect(user2Signer)
        ['claimRewards(address,bool)'](userSigner._address, true)
      const userBalance4 = await stkAave.balanceOf(userSigner._address)

      await waitForTx(
        await staticAToken
          .connect(userSigner)
          ['claimRewards(address,bool)'](user2Signer._address, true)
      )

      const pendingRewards5 = await staticAToken.getClaimableRewards(userSigner._address)
      const user2Balance5 = await stkAave.balanceOf(user2Signer._address)

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
        await weth.approve(staticAToken.address, amountToDeposit.mul(2), defaultTxParams)
      )

      // Depositing
      await waitForTx(
        await staticAToken.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
      )

      const pendingRewards1 = await staticAToken.getClaimableRewards(userSigner._address)

      await advanceTime(60 * 60)
      await waitForTx(await staticAToken.collectAndUpdateRewards())

      const pendingRewards2 = await staticAToken.getClaimableRewards(userSigner._address)

      // Withdrawing all.
      await waitForTx(
        await staticAToken.withdraw(userSigner._address, amountToWithdraw, true, defaultTxParams)
      )

      const pendingRewards3 = await staticAToken.getClaimableRewards(userSigner._address)

      await waitForTx(await staticAToken.connect(userSigner).claimRewardsToSelf(true))

      const pendingRewards4 = await staticAToken.getClaimableRewards(userSigner._address)
      const userBalance4 = await stkAave.balanceOf(userSigner._address)

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
        await weth.approve(staticAToken.address, amountToDeposit.mul(2), defaultTxParams)
      )

      // Depositing
      await waitForTx(
        await staticAToken.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
      )

      const pendingRewards1 = await staticAToken.getClaimableRewards(userSigner._address)

      await waitForTx(await staticAToken.collectAndUpdateRewards())
      await advanceTime(60 * 60)

      const pendingRewards2 = await staticAToken.getClaimableRewards(userSigner._address)

      // Withdrawing all.
      await waitForTx(
        await staticAToken.withdraw(userSigner._address, amountToWithdraw, true, defaultTxParams)
      )

      // How will my pending look now
      const pendingRewards3 = await staticAToken.getClaimableRewards(userSigner._address)
      const unclaimedRewards3 = await staticAToken.getUnclaimedRewards(userSigner._address)

      await waitForTx(await staticAToken.connect(userSigner).claimRewardsToSelf(false))

      const pendingRewards4 = await staticAToken.getClaimableRewards(userSigner._address)
      const userBalance4 = await stkAave.balanceOf(userSigner._address)
      const totClaimable4 = await staticAToken.getTotalClaimableRewards()
      const unclaimedRewards4 = await staticAToken.getUnclaimedRewards(userSigner._address)

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

    it('Potential loss of rewards on transfer', async () => {
      const amountToDeposit = utils.parseEther('5')

      // Just preparation
      await waitForTx(await weth.deposit({ value: amountToDeposit.mul(2) }))
      await waitForTx(
        await weth.approve(staticAToken.address, amountToDeposit.mul(2), defaultTxParams)
      )

      // Depositing
      await waitForTx(
        await staticAToken.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
      )

      const pendingRewards1_u1 = await staticAToken.getClaimableRewards(userSigner._address)
      const pendingRewards1_u2 = await staticAToken.getClaimableRewards(user2Signer._address)

      // No rewards assigned yet
      expect(pendingRewards1_u1).to.be.eq(0)
      expect(pendingRewards1_u2).to.be.eq(0)

      await advanceTime(60 * 60)

      // User1 now has some pending rewards. User2 should have no rewards.
      const pendingRewards2_u1 = await staticAToken.getClaimableRewards(userSigner._address)
      const pendingRewards2_u2 = await staticAToken.getClaimableRewards(user2Signer._address)
      expect(pendingRewards2_u1).to.be.gt(pendingRewards1_u1)
      expect(pendingRewards2_u2).to.be.eq(0)

      // Transfer staticATokens to user2
      await waitForTx(
        await staticAToken.transfer(
          user2Signer._address,
          await staticAToken.balanceOf(userSigner._address)
        )
      )

      // User1 now has zero pending rewards, all transferred to User2
      const pendingRewards3_u1 = await staticAToken.getClaimableRewards(userSigner._address)
      const pendingRewards3_u2 = await staticAToken.getClaimableRewards(user2Signer._address)

      expect(pendingRewards3_u1).to.be.eq(0)
      expect(pendingRewards3_u2).to.be.gt(pendingRewards2_u1)

      // User2 can keep the rewards if for example `collectAndUpdateRewards` is called
      await staticAToken.collectAndUpdateRewards()

      // If transfer is performed to User1, rewards stay with User2
      await waitForTx(
        await staticAToken
          .connect(user2Signer)
          .transfer(userSigner._address, await staticAToken.balanceOf(user2Signer._address))
      )

      // User1 gets only some small rewards, but User2 keeps the rewards
      const pendingRewards4_u1 = await staticAToken.getClaimableRewards(userSigner._address)
      const pendingRewards4_u2 = await staticAToken.getClaimableRewards(user2Signer._address)

      expect(pendingRewards4_u1).to.be.gt(0)
      expect(pendingRewards4_u1).to.be.lt(pendingRewards4_u2)
      expect(pendingRewards4_u2).to.be.gt(pendingRewards3_u2)
    })

    it('Loss of rewards when claiming with forceUpdate=false', async () => {
      const amountToDeposit = utils.parseEther('5')

      // Just preparation
      await waitForTx(await weth.deposit({ value: amountToDeposit.mul(2) }))
      await waitForTx(
        await weth.approve(staticAToken.address, amountToDeposit.mul(2), defaultTxParams)
      )

      // Depositing
      await waitForTx(
        await staticAToken.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
      )
      await advanceTime(1)

      //***** need small reward balace
      await staticAToken.collectAndUpdateRewards()
      const staticATokenBalanceFirst = await stkAave.balanceOf(staticAToken.address)
      expect(staticATokenBalanceFirst).to.be.gt(0)

      await advanceTime(60 * 60 * 24)

      // Depositing
      await waitForTx(
        await staticAToken.deposit(userSigner._address, amountToDeposit, 0, true, defaultTxParams)
      )

      const beforeRewardBalance = await stkAave.balanceOf(userSigner._address)
      const pendingRewardsBefore = await staticAToken.getClaimableRewards(userSigner._address)

      // User has no balance yet
      expect(beforeRewardBalance).to.equal(0)
      // Additional rewards exist to be collected
      expect(pendingRewardsBefore).to.be.gt(staticATokenBalanceFirst)

      // user claim forceUpdate = false
      await waitForTx(await staticAToken.connect(userSigner).claimRewardsToSelf(false))

      const afterRewardBalance = await stkAave.balanceOf(userSigner._address)
      const pendingRewardsAfter = await staticAToken.getClaimableRewards(userSigner._address)

      const pendingRewardsDecline = pendingRewardsBefore.toNumber() - pendingRewardsAfter.toNumber()
      const getRewards = afterRewardBalance.toNumber() - beforeRewardBalance.toNumber()
      const staticATokenBalanceAfter = await stkAave.balanceOf(staticAToken.address)

      // User has the funds, nothing remains in contract
      expect(afterRewardBalance).to.equal(staticATokenBalanceFirst)
      expect(staticATokenBalanceAfter).to.equal(0)

      // Check there is a loss
      expect(pendingRewardsDecline - getRewards).to.be.gt(0)
    })
  })

  it('Multiple users deposit WETH on stataWETH, wait 1 hour, update rewards, one user transfer, then claim and update rewards.', async () => {
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
          .approve(staticAToken.address, amountToDeposit, defaultTxParams)
      )

      // Deposit
      await waitForTx(
        await staticAToken
          .connect(currentUser)
          .deposit(await currentUser.getAddress(), amountToDeposit, 0, true, defaultTxParams)
      )
    }

    // Advance time to accrue significant rewards.
    await advanceTime(60 * 60)
    await staticAToken.collectAndUpdateRewards()

    const staticATokenTotClaimableInitial = await staticAToken.getTotalClaimableRewards()
    const usersDataInitial = await getUserData(users, _debugUserData, staticAToken, stkAave)

    await waitForTx(
      await staticAToken
        .connect(users[0])
        .transfer(
          await users[1].getAddress(),
          await staticAToken.balanceOf(await users[0].getAddress())
        )
    )

    await advanceTime(60 * 60)

    for (let i = 0; i < 5; i++) {
      // This will claim the first half of the collected tokens (those collected at `collectAndUpdateRewards`)
      await waitForTx(await staticAToken.connect(users[i]).claimRewardsToSelf(false))
    }

    const staticATokenTotClaimableAfterTransferAndClaim =
      await staticAToken.getTotalClaimableRewards()
    const usersDataAfterTransferAndClaim = await getUserData(
      users,
      _debugUserData,
      staticAToken,
      stkAave
    )

    await waitForTx(await staticAToken.collectAndUpdateRewards())

    const staticATokenTotClaimableFinal = await staticAToken.getTotalClaimableRewards()
    const usersDataFinal = await getUserData(users, _debugUserData, staticAToken, stkAave)

    // Time for checks
    let pendingRewardsSumInitial = BigNumber.from(0)
    let pendingRewardsSumAfter = BigNumber.from(0)
    let pendingRewardsSumFinal = BigNumber.from(0)
    for (let i = 0; i < 5; i++) {
      expect(usersDataInitial[i].stkAaveBalance).to.be.eq(0)
      expect(usersDataAfterTransferAndClaim[i].stkAaveBalance).to.be.eq(
        usersDataInitial[i].pendingRewards
      )
      if (i > 1) {
        // Expect initial static balance == after transfer == after claiming
        expect(usersDataInitial[i].staticBalance).to.be.eq(
          usersDataAfterTransferAndClaim[i].staticBalance
        )
        expect(usersDataInitial[i].staticBalance).to.be.eq(usersDataFinal[i].staticBalance)
        expect(usersDataInitial[i].pendingRewards.add(usersDataInitial[i].stkAaveBalance)).to.be.lt(
          usersDataAfterTransferAndClaim[i].pendingRewards.add(
            usersDataAfterTransferAndClaim[i].stkAaveBalance
          )
        )
        expect(
          usersDataAfterTransferAndClaim[i].pendingRewards.add(
            usersDataAfterTransferAndClaim[i].stkAaveBalance
          )
        ).to.be.lt(usersDataFinal[i].pendingRewards.add(usersDataFinal[i].stkAaveBalance))
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
    expect(usersDataFinal[1].pendingRewards.add(usersDataFinal[1].stkAaveBalance)).to.be.gt(
      usersDataFinal[2].pendingRewards.add(usersDataFinal[2].stkAaveBalance).mul(145).div(100)
    )
    expect(usersDataFinal[1].pendingRewards.add(usersDataFinal[1].stkAaveBalance)).to.be.lt(
      usersDataFinal[2].pendingRewards.add(usersDataFinal[2].stkAaveBalance).mul(155).div(100)
    )

    // Expect there to be excess stkAave in the contract. Expect it to be dust. This ensure that everyone can claim full amount of rewards.
    expect(pendingRewardsSumInitial).to.be.lte(staticATokenTotClaimableInitial)
    expect(staticATokenTotClaimableInitial.sub(pendingRewardsSumInitial)).to.be.lte(DUST)

    expect(pendingRewardsSumAfter).to.be.lte(staticATokenTotClaimableAfterTransferAndClaim)
    expect(staticATokenTotClaimableAfterTransferAndClaim.sub(pendingRewardsSumAfter)).to.be.lte(
      DUST
    )

    expect(pendingRewardsSumFinal).to.be.lte(staticATokenTotClaimableFinal)
    expect(staticATokenTotClaimableFinal.sub(pendingRewardsSumFinal)).to.be.lte(DUST)
  })

  it('Multiple users deposit WETH on stataWETH, wait 1 hour, one user transfer, then claim and update rewards.', async () => {
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
          .approve(staticAToken.address, amountToDeposit, defaultTxParams)
      )

      // Deposit
      await waitForTx(
        await staticAToken
          .connect(currentUser)
          .deposit(await currentUser.getAddress(), amountToDeposit, 0, true, defaultTxParams)
      )
    }

    // Advance time to accrue significant rewards.
    await advanceTime(60 * 60)

    const staticATokenTotClaimableInitial = await staticAToken.getTotalClaimableRewards()
    const usersDataInitial = await getUserData(users, _debugUserData, staticAToken, stkAave)

    // User 0 transfer full balance of staticATokens to user 1. This will also transfer the rewards since last update as well.
    await waitForTx(
      await staticAToken
        .connect(users[0])
        .transfer(
          await users[1].getAddress(),
          await staticAToken.balanceOf(await users[0].getAddress())
        )
    )

    await advanceTime(60 * 60)

    for (let i = 0; i < 5; i++) {
      // This will not do anything, hence there is no rewards in the current contract.
      await waitForTx(await staticAToken.connect(users[i]).claimRewardsToSelf(false))
    }

    const staticATokenTotClaimableAfterTransfer = await staticAToken.getTotalClaimableRewards()
    const usersDataAfterTransfer = await getUserData(users, _debugUserData, staticAToken, stkAave)

    await waitForTx(await staticAToken.collectAndUpdateRewards())

    const staticATokenTotClaimableFinal = await staticAToken.getTotalClaimableRewards()
    const usersDataFinal = await getUserData(users, _debugUserData, staticAToken, stkAave)

    // Time for checks
    let pendingRewardsSumInitial = BigNumber.from(0)
    let pendingRewardsSumAfter = BigNumber.from(0)
    let pendingRewardsSumFinal = BigNumber.from(0)
    for (let i = 0; i < 5; i++) {
      expect(usersDataInitial[i].stkAaveBalance).to.be.eq(0)
      expect(usersDataAfterTransfer[i].stkAaveBalance).to.be.eq(0)
      expect(usersDataFinal[i].stkAaveBalance).to.be.eq(0)
      if (i > 1) {
        // Expect initial static balance == after transfer == after claiming
        expect(usersDataInitial[i].staticBalance).to.be.eq(usersDataAfterTransfer[i].staticBalance)
        expect(usersDataInitial[i].staticBalance).to.be.eq(usersDataFinal[i].staticBalance)
      }

      pendingRewardsSumInitial = pendingRewardsSumInitial.add(usersDataInitial[i].pendingRewards)
      pendingRewardsSumAfter = pendingRewardsSumAfter.add(usersDataAfterTransfer[i].pendingRewards)
      pendingRewardsSumFinal = pendingRewardsSumFinal.add(usersDataFinal[i].pendingRewards)
    }

    expect(await staticAToken.getTotalClaimableRewards()).to.be.eq(
      await stkAave.balanceOf(staticAToken.address)
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

    // Expect there to be excess stkAave in the contract.
    // Expect it to be dust. This ensure that everyone can claim full amount of rewards.
    expect(pendingRewardsSumInitial).to.be.lte(staticATokenTotClaimableInitial)
    expect(staticATokenTotClaimableInitial.sub(pendingRewardsSumInitial)).to.be.lte(DUST)

    expect(pendingRewardsSumAfter).to.be.lte(staticATokenTotClaimableAfterTransfer)
    expect(staticATokenTotClaimableAfterTransfer.sub(pendingRewardsSumAfter)).to.be.lte(DUST)

    expect(pendingRewardsSumFinal).to.be.lte(staticATokenTotClaimableFinal)
    expect(staticATokenTotClaimableFinal.sub(pendingRewardsSumFinal)).to.be.lte(DUST) // How small should we say dust is?
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
          .approve(staticAToken.address, amountToDeposit, defaultTxParams)
      )

      // Deposit
      await waitForTx(
        await staticAToken
          .connect(currentUser)
          .deposit(await currentUser.getAddress(), amountToDeposit, 0, true, defaultTxParams)
      )
    }

    // Advance time to accrue significant rewards.
    await advanceTime(60 * 60)
    await waitForTx(await staticAToken.collectAndUpdateRewards())

    const pendingRewards: BigNumber[] = []

    for (let i = 0; i < users.length; i++) {
      const pendingReward = await staticAToken.getClaimableRewards(await users[i].getAddress())
      pendingRewards.push(pendingReward)
    }
    for (let i = 0; i < users.length; i++) {
      await waitForTx(await staticAToken.connect(users[i]).claimRewardsToSelf(false))
      expect(await stkAave.balanceOf(await users[i].getAddress())).to.be.eq(pendingRewards[i])
    }
    expect(await stkAave.balanceOf(staticAToken.address)).to.be.lt(DUST)
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
          .approve(staticAToken.address, amountToDeposit, defaultTxParams)
      )

      // Deposit
      await waitForTx(
        await staticAToken
          .connect(currentUser)
          .deposit(await currentUser.getAddress(), amountToDeposit, 0, true, defaultTxParams)
      )
    }

    // Advance time to accrue significant rewards.
    await advanceTime(60 * 60)
    await waitForTx(await staticAToken.collectAndUpdateRewards())

    const pendingRewards: BigNumber[] = []
    let sum: BigNumber = BigNumber.from(0)
    const receiverAddress = await users[0].getAddress()

    for (let i = 0; i < users.length; i++) {
      const pendingReward = await staticAToken.getClaimableRewards(await users[i].getAddress())
      pendingRewards.push(pendingReward)
    }
    for (let i = 0; i < users.length; i++) {
      await waitForTx(
        await staticAToken.connect(users[i])['claimRewards(address,bool)'](receiverAddress, false)
      )
      sum = sum.add(pendingRewards[i])
      expect(await stkAave.balanceOf(await receiverAddress)).to.be.eq(sum)
    }
    expect(await stkAave.balanceOf(staticAToken.address)).to.be.lt(DUST)
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
          .approve(staticAToken.address, amountToDeposit, defaultTxParams)
      )

      // Deposit
      await waitForTx(
        await staticAToken
          .connect(currentUser)
          .deposit(await currentUser.getAddress(), amountToDeposit, 0, true, defaultTxParams)
      )

      await advanceTime(60)

      await waitForTx(
        await staticAToken
          .connect(currentUser)
          .withdraw(await currentUser.getAddress(), MAX_UINT256, true, defaultTxParams)
      )

      const pendingReward = await staticAToken.getClaimableRewards(await users[i].getAddress())
      await waitForTx(await staticAToken.connect(users[i]).claimRewardsToSelf(true))
      expect(await stkAave.balanceOf(await users[i].getAddress())).to.be.eq(pendingReward)
    }
  })

  it('Checks that withdraw and collect in different blocks updates _lifetimeRewardsClaimed as expected', async () => {
    const users = await hre.ethers.getSigners()
    const user = users[0]
    const depositAmount = utils.parseEther('1')

    // Preparation
    await waitForTx(await weth.connect(user).deposit({ value: depositAmount }))
    await waitForTx(
      await weth.connect(user).approve(staticAToken.address, depositAmount, defaultTxParams)
    )

    // Deposit
    await waitForTx(
      await staticAToken
        .connect(user)
        .deposit(await user.getAddress(), depositAmount, 0, true, defaultTxParams)
    )

    await advanceTime(60)

    expect(await staticAToken.getLifetimeRewardsClaimed()).to.be.eq(0)
    expect(await staticAToken.getClaimableRewards(user.address)).to.be.gt(0)
    expect(await stkAave.balanceOf(user.address)).to.be.eq(0)

    await waitForTx(await staticAToken.connect(user).withdraw(user.address, MAX_UINT256, true))
    await staticAToken.collectAndUpdateRewards()
    await staticAToken.connect(user).claimRewardsToSelf(false)

    expect(await staticAToken.getLifetimeRewardsClaimed()).to.be.gt(0)
    expect(await staticAToken.getClaimableRewards(user.address)).to.be.eq(0)
    expect(await stkAave.balanceOf(user.address)).to.be.gt(0)
  })

  it('Checks that withdraw and collect in the same block updates _lifetimeRewardsClaimed as expected (Breaks if GasReport is enabled)', async () => {
    const users = await hre.ethers.getSigners()
    const user = users[0]
    const depositAmount = utils.parseEther('1')

    // Preparation
    await waitForTx(await weth.connect(user).deposit({ value: depositAmount }))
    await waitForTx(
      await weth.connect(user).approve(staticAToken.address, depositAmount, defaultTxParams)
    )

    // Deposit
    await waitForTx(
      await staticAToken
        .connect(user)
        .deposit(await user.getAddress(), depositAmount, 0, true, defaultTxParams)
    )

    await advanceTime(60)

    expect(await staticAToken.getLifetimeRewardsClaimed()).to.be.eq(0)
    expect(await staticAToken.getClaimableRewards(user.address)).to.be.gt(0)
    expect(await stkAave.balanceOf(user.address)).to.be.eq(0)

    await hre.network.provider.send('evm_setAutomine', [false])

    await staticAToken.connect(user).withdraw(user.address, MAX_UINT256, true)
    await staticAToken.collectAndUpdateRewards()
    await staticAToken.connect(user).claimRewardsToSelf(false)

    await hre.network.provider.send('evm_mine', [])
    await hre.network.provider.send('evm_setAutomine', [true])

    expect(await staticAToken.getLifetimeRewardsClaimed()).to.be.gt(0)
    expect(await staticAToken.getClaimableRewards(user.address)).to.be.eq(0)
    expect(await stkAave.balanceOf(user.address)).to.be.gt(0)
  })

  it('Handles AToken with no incentives controller', async () => {
    const StaticATokenFactory: ContractFactory = await ethers.getContractFactory('StaticATokenLM')

    const aWETHNoController: ATokenNoController = <ATokenNoController>(
      await (
        await ethers.getContractFactory('ATokenNoController')
      ).deploy(
        networkConfig[chainId].AAVE_LENDING_POOL,
        weth.address,
        networkConfig[chainId].AAVE_RESERVE_TREASURY,
        'aWETH-NC',
        'aWETH-NC',
        ZERO_ADDRESS
      )
    )

    const staticATokenNoController: StaticATokenLM = <StaticATokenLM>(
      await StaticATokenFactory.connect(userSigner).deploy(
        networkConfig[chainId].AAVE_LENDING_POOL,
        aWETHNoController.address,
        'Static Aave Interest Bearing WETH - No controller',
        'stataWETH-NC'
      )
    )

    expect(await staticATokenNoController.getIncentivesController()).to.be.eq(ZERO_ADDRESS)

    expect(await staticATokenNoController.UNDERLYING_ASSET_ADDRESS()).to.be.eq(weth.address)

    // Deposit
    const amountToDeposit = utils.parseEther('5')
    const amountToWithdraw = MAX_UINT256

    // Just preparation
    await waitForTx(await weth.deposit({ value: amountToDeposit.mul(2) }))
    await waitForTx(
      await weth.approve(staticATokenNoController.address, amountToDeposit.mul(2), defaultTxParams)
    )

    // Depositing
    await waitForTx(
      await staticATokenNoController.deposit(
        userSigner._address,
        amountToDeposit,
        0,
        true,
        defaultTxParams
      )
    )

    const pendingRewards1 = await staticATokenNoController.getClaimableRewards(userSigner._address)

    expect(pendingRewards1).to.equal(0)

    // Depositing
    await waitForTx(
      await staticATokenNoController.deposit(
        userSigner._address,
        amountToDeposit,
        0,
        true,
        defaultTxParams
      )
    )

    const pendingRewards2 = await staticATokenNoController.getClaimableRewards(userSigner._address)

    await waitForTx(await staticATokenNoController.collectAndUpdateRewards())
    await waitForTx(await staticATokenNoController.connect(userSigner)['claimRewards()']())

    const pendingRewards3 = await staticATokenNoController.getClaimableRewards(userSigner._address)

    expect(pendingRewards2).to.equal(0)
    expect(pendingRewards3).to.equal(0)

    // Withdrawing all.
    await waitForTx(
      await staticATokenNoController.withdraw(
        userSigner._address,
        amountToWithdraw,
        true,
        defaultTxParams
      )
    )

    const pendingRewards4 = await staticATokenNoController.getClaimableRewards(userSigner._address)
    const totPendingRewards4 = await staticATokenNoController.getTotalClaimableRewards()
    const claimedRewards4 = await stkAave.balanceOf(userSigner._address)
    const stkAaveStatic4 = await stkAave.balanceOf(staticATokenNoController.address)

    await waitForTx(await staticATokenNoController.connect(userSigner).claimRewardsToSelf(false))
    await waitForTx(
      await staticATokenNoController
        .connect(userSigner)
        ['claimRewards(address,bool)'](userSigner._address, true)
    )
    await waitForTx(
      await staticATokenNoController
        .connect(userSigner)
        .claimRewardsOnBehalf(userSigner._address, userSigner._address, true)
    )

    const pendingRewards5 = await staticATokenNoController.getClaimableRewards(userSigner._address)
    const totPendingRewards5 = await staticATokenNoController.getTotalClaimableRewards()
    const claimedRewards5 = await stkAave.balanceOf(userSigner._address)
    const stkAaveStatic5 = await stkAave.balanceOf(staticATokenNoController.address)

    await waitForTx(await staticATokenNoController.collectAndUpdateRewards())
    const pendingRewards6 = await staticATokenNoController.getClaimableRewards(userSigner._address)

    // Checks
    expect(pendingRewards2).to.equal(0)
    expect(pendingRewards3).to.equal(0)
    expect(pendingRewards4).to.equal(0)
    expect(totPendingRewards4).to.eq(0)
    expect(pendingRewards5).to.be.eq(0)
    expect(pendingRewards6).to.be.eq(0)
    expect(claimedRewards4).to.be.eq(0)
    expect(claimedRewards5).to.be.eq(0)
    expect(totPendingRewards5).to.be.eq(0)
    expect(stkAaveStatic4).to.equal(0)
    expect(stkAaveStatic5).to.equal(0)
  })
})
