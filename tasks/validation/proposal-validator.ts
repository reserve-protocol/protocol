import { task } from 'hardhat/config'
import { networkConfig } from '../../common/configuration'
import { getChainId } from '../../common/blockchain-utils'
import { whileImpersonating } from '#/utils/impersonation'
import { useEnv } from '#/utils/env'
import { expect } from 'chai'
import { fp } from '#/common/numbers'
import { MAX_UINT256, TradeKind, ZERO_BYTES } from '#/common/constants'
import { formatEther, formatUnits } from 'ethers/lib/utils'
import { recollateralize, redeemRTokens } from './utils/rtokens'
import { claimRsrRewards } from './utils/rewards'
import { pushOraclesForward } from './utils/oracles'
import {
  passProposal,
  executeProposal,
  proposeUpgrade,
  stakeAndDelegateRsr,
  moveProposalToActive,
  voteProposal,
} from './utils/governance'
import { advanceTime, getLatestBlockNumber } from '#/utils/time'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { resetFork } from '#/utils/chain'
import fs from 'fs'
import { BigNumber } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BasketHandlerP1 } from '@typechain/BasketHandlerP1'
import { RTokenP1 } from '@typechain/RTokenP1'
import { StRSRP1Votes } from '@typechain/StRSRP1Votes'
import { IMain } from '@typechain/IMain'
import { Whales, getWhalesFile } from '#/scripts/whalesConfig'
import { proposal_3_4_0_step_1, proposal_3_4_0_step_2 } from './proposals/3_4_0'

// Use this once to serialize a proposal
task('save-proposal', 'Save proposal')
  .addParam('rtoken', 'the address of the RToken being upgraded')
  .addParam('governor', 'the address of the OWNER of the RToken being upgraded')
  .addParam('timelock', 'the address of the TimelockController')
  .setAction(async (params, hre) => {
    const step1 = await proposal_3_4_0_step_1(hre, params.rtoken, params.governor, params.timelock)
    step1.rtoken = params.rtoken
    step1.governor = params.governor
    step1.timelock = params.timelock

    const governor = await hre.ethers.getContractAt('Governance', params.governor)
    const descHash = hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes(step1.description))
    step1.proposalId = BigNumber.from(
      await governor.hashProposal(step1.targets, step1.values, step1.calldatas, descHash)
    ).toString()

    console.log(step1)
    fs.writeFileSync(
      `./tasks/validation/proposals/proposal-${step1.proposalId}.json`,
      JSON.stringify(step1, null, 4)
    )

    // const step2 = await proposal_3_4_0_step_2(hre, params.rtoken, params.governor, params.timelock)
    // console.log(step2)
  })

interface Params {
  proposalid?: string
}

task('proposal-validator', 'Runs a proposal and confirms can fully rebalance + redeem + mint')
  .addParam('proposalid', 'the ID of the governance proposal', undefined)
  .setAction(async (params: Params, hre) => {
    await resetFork(hre, Number(process.env.FORK_BLOCK))

    const chainId = await getChainId(hre)

    // make sure config exists
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }

    // only run locally
    if (hre.network.name != 'localhost' && hre.network.name != 'hardhat') {
      throw new Error('Only run this on a local fork')
    }

    // make sure subgraph is configured
    if (params.proposalid && !useEnv('SUBGRAPH_URL')) {
      throw new Error('SUBGRAPH_URL required for subgraph queries')
    }

    console.log(`Network Block: ${await getLatestBlockNumber(hre)}`)

    await hre.run('propose', {
      pid: params.proposalid,
    })

    const proposalData = JSON.parse(
      fs.readFileSync(`./tasks/validation/proposals/proposal-${params.proposalid}.json`, 'utf-8')
    )
    await hre.run('recollateralize', {
      rtoken: proposalData.rtoken,
      governor: proposalData.governor,
    })

    await hre.run('run-validations', {
      rtoken: proposalData.rtoken,
      governor: proposalData.governor,
    })

    const rToken = await hre.ethers.getContractAt('IRToken', proposalData.rtoken)
    const main = await hre.ethers.getContractAt('IMain', await rToken.main())
    const assetRegistry = await hre.ethers.getContractAt(
      'IAssetRegistry',
      await main.assetRegistry()
    )
    const basketHandler = await hre.ethers.getContractAt(
      'IBasketHandler',
      await main.basketHandler()
    )
    await assetRegistry.refresh()
    if (!((await basketHandler.status()) == 0)) throw new Error('Basket is not SOUND')
    if (!(await basketHandler.fullyCollateralized())) {
      throw new Error('Basket is not fully collateralized')
    }
    console.log('Basket is SOUND and fully collateralized!')
  })

interface ProposeParams {
  pid: string
}

task('propose', 'propose a gov action')
  .addParam('pid', 'the ID of the governance proposal')
  .setAction(async (params: ProposeParams, hre) => {
    const proposalData = JSON.parse(
      fs.readFileSync(`./tasks/validation/proposals/proposal-${params.pid}.json`, 'utf-8')
    )

    const proposal = await proposeUpgrade(
      hre,
      proposalData.rtoken,
      proposalData.governor,
      proposalData
    )

    if (proposal.proposalId != params.pid) {
      throw new Error(`Proposed Proposal ID does not match expected ID: ${params.pid}`)
    }

    await moveProposalToActive(hre, proposalData.rtoken, proposalData.governor, proposal.proposalId)
    await voteProposal(hre, proposalData.rtoken, proposalData.governor, proposal.proposalId)
    await passProposal(hre, proposalData.governor, proposal.proposalId)
    await executeProposal(
      hre,
      proposalData.rtoken,
      proposalData.governor,
      proposal.proposalId,
      proposal
    )
  })

task('recollateralize')
  .addParam('rtoken', 'the address of the RToken being upgraded')
  .addParam('governor', 'the address of the OWNER of the RToken being upgraded')
  .setAction(async (params, hre) => {
    const rToken = await hre.ethers.getContractAt('RTokenP1', params.rtoken)

    // 2. Bring back to fully collateralized
    const main = await hre.ethers.getContractAt('IMain', await rToken.main())
    const basketHandler = await hre.ethers.getContractAt(
      'BasketHandlerP1',
      await main.basketHandler()
    )
    const backingManager = await hre.ethers.getContractAt(
      'BackingManagerP1',
      await main.backingManager()
    )

    /*
      recollateralize
    */
    await advanceTime(hre, (await backingManager.tradingDelay()) + 1)
    await pushOraclesForward(hre, params.rtoken, [])
    await recollateralize(hre, rToken.address, TradeKind.DUTCH_AUCTION).catch((e: Error) => {
      if (e.message.includes('already collateralized')) {
        console.log('Already Collateralized!')
        return
      }
      throw e
    })
    if (!(await basketHandler.fullyCollateralized())) throw new Error('Failed to recollateralize')
  })

task('run-validations', 'Runs all validations')
  .addParam('rtoken', 'the address of the RToken being upgraded')
  .addParam('governor', 'the address of the OWNER of the RToken being upgraded')
  .setAction(async (params, hre) => {
    const [tester] = await hre.ethers.getSigners()
    const rToken = await hre.ethers.getContractAt('RTokenP1', params.rtoken)

    // 2. Bring back to fully collateralized
    const main = await hre.ethers.getContractAt('IMain', await rToken.main())
    const basketHandler = await hre.ethers.getContractAt(
      'BasketHandlerP1',
      await main.basketHandler()
    )
    const stRSR = await hre.ethers.getContractAt('StRSRP1Votes', await main.stRSR())

    const chainId = await getChainId(hre)
    const whales: Whales = getWhalesFile(chainId).tokens

    /*
      redeem
    */
    // Give `tester` RTokens from a whale
    const redeemAmt = fp('1e4')
    await whileImpersonating(hre, whales[params.rtoken.toLowerCase()], async (whaleSigner) => {
      await rToken.connect(whaleSigner).transfer(tester.address, redeemAmt)
    })
    if (!(await rToken.balanceOf(tester.address)).gte(redeemAmt)) throw new Error('missing R')

    await runCheck_redeem(hre, tester, rToken.address, redeemAmt)

    /*
      mint
    */
    await runCheck_mint(hre, fp('1e3'), tester, basketHandler, rToken)

    /*
      claim rewards
    */
    await claimRsrRewards(hre, params.rtoken)

    await pushOraclesForward(hre, params.rtoken, [])

    /*
      staking/unstaking
    */
    await runCheck_stakeUnstake(hre, tester, rToken, stRSR, main)
  })

const runCheck_stakeUnstake = async (
  hre: HardhatRuntimeEnvironment,
  tester: SignerWithAddress,
  rToken: RTokenP1,
  stRSR: StRSRP1Votes,
  main: IMain
) => {
  const chainId = await getChainId(hre)
  const whales = getWhalesFile(chainId).tokens

  // get RSR
  const stakeAmount = fp('4e6')
  const rsr = await hre.ethers.getContractAt('StRSRP1Votes', await main.rsr())
  await whileImpersonating(
    hre,
    whales[networkConfig['1'].tokens.RSR!.toLowerCase()],
    async (rsrSigner) => {
      await rsr.connect(rsrSigner).transfer(tester.address, stakeAmount)
    }
  )

  const balPrevRSR = await rsr.balanceOf(stRSR.address)
  const balPrevStRSR = await stRSR.balanceOf(tester.address)
  const testerBal = await rsr.balanceOf(tester.address)

  await stakeAndDelegateRsr(hre, rToken.address, tester.address)

  expect(await rsr.balanceOf(stRSR.address)).to.equal(balPrevRSR.add(testerBal))
  expect(await stRSR.balanceOf(tester.address)).to.be.gt(balPrevStRSR)
}

const runCheck_redeem = async (
  hre: HardhatRuntimeEnvironment,
  signer: SignerWithAddress,
  rToken: string,
  redeemAmt: BigNumber
) => {
  await redeemRTokens(hre, signer, rToken, redeemAmt)
}

const runCheck_mint = async (
  hre: HardhatRuntimeEnvironment,
  issueAmt: BigNumber,
  signer: SignerWithAddress,
  basketHandler: BasketHandlerP1,
  rToken: RTokenP1
) => {
  console.log(`\nIssuing  ${formatEther(issueAmt)} RTokens...`)
  const [erc20s] = await basketHandler.quote(fp('1'), 0)
  for (const e of erc20s) {
    const erc20 = await hre.ethers.getContractAt(
      '@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20',
      e
    )
    await erc20.connect(signer).approve(rToken.address, MAX_UINT256) // max approval
  }
  const preBal = await rToken.balanceOf(signer.address)
  await rToken.connect(signer).issue(issueAmt)

  const postIssueBal = await rToken.balanceOf(signer.address)
  if (!postIssueBal.eq(preBal.add(issueAmt))) {
    throw new Error(
      `Did not issue the correct amount of RTokens. wanted: ${formatUnits(
        preBal.add(issueAmt),
        'mwei'
      )}    balance: ${formatUnits(postIssueBal, 'mwei')}`
    )
  }

  console.log('Successfully minted RTokens')
}

import { proposal_3_4_0_step_1 } from './proposals/3_4_0'

task('print-proposal')
  .addParam('rtoken', 'the address of the RToken being upgraded')
  .addParam('gov', 'the address of the OWNER of the RToken being upgraded')
  .addParam('time', 'the address of the timelock')
  .setAction(async (params, hre) => {
    const proposal = await proposal_3_4_0_step_1(hre, params.rtoken, params.gov, params.time)

    console.log(`\nGenerating and proposing proposal...`)
    const [tester] = await hre.ethers.getSigners()
  
    await hre.run('give-rsr', { address: tester.address })
    await stakeAndDelegateRsr(hre, params.rtoken, tester.address)
  
    const governor = await hre.ethers.getContractAt('Governance', params.gov)
  
    const call = await governor.populateTransaction.propose(
      proposal.targets,
      proposal.values,
      proposal.calldatas,
      proposal.description
    )
  
    console.log(`Proposal Transaction:\n`, call.data)
  
    const r = await governor.propose(
      proposal.targets,
      proposal.values,
      proposal.calldatas,
      proposal.description
    )
    const resp = await r.wait()
  
    console.log('\nSuccessfully proposed!')
    console.log(`Proposal ID: ${resp.events![0].args!.proposalId}`)
  
    proposal.proposalId = resp.events![0].args!.proposalId.toString()

    fs.writeFileSync(`./tasks/validation/proposals/proposal-${proposal.proposalId}.json`, JSON.stringify(proposal, null, 2))
  })