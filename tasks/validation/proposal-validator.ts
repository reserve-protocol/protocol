import { task } from 'hardhat/config'
import { networkConfig } from '../../common/configuration'
import { getChainId } from '../../common/blockchain-utils'
import { whileImpersonating } from '#/utils/impersonation'
import { useEnv } from '#/utils/env'
import { expect } from 'chai'
import { fp } from '#/common/numbers'
import { MAX_UINT256, TradeKind } from '#/common/constants'
import { formatEther, formatUnits } from 'ethers/lib/utils'
import { recollateralize, redeemRTokens } from './utils/rtokens'
import { processRevenue } from './utils/rewards'
import { pushOraclesForward } from './utils/oracles'
import {
  passProposal,
  executeProposal,
  proposeUpgrade,
  stakeAndDelegateRsr,
  unstakeAndWithdrawRsr,
  moveProposalToActive,
  voteProposal,
} from './utils/governance'
import { advanceTime, getLatestBlockNumber } from '#/utils/time'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import fs from 'fs'
import { BigNumber } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BasketHandlerP1 } from '@typechain/BasketHandlerP1'
import { RTokenP1 } from '@typechain/RTokenP1'
import { StRSRP1Votes } from '@typechain/StRSRP1Votes'
import { IMain } from '@typechain/IMain'
import { Whales, getWhalesFile } from '#/scripts/whalesConfig'
import { proposal_3_4_0_step_2 } from './proposals/3_4_0'
import { validateSubgraphURL, Network } from '#/utils/fork'

interface Params {
  proposalid?: string
}

task('proposal-validator', 'Runs a proposal and confirms can fully rebalance + redeem + mint')
  .addParam('proposalid', 'the ID of the governance proposal', undefined)
  .setAction(async (params: Params, hre) => {
    // await resetFork(hre, Number(process.env.FORK_BLOCK))

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
    if (params.proposalid) validateSubgraphURL(useEnv('FORK_NETWORK') as Network)

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
      'TestIBasketHandler',
      await main.basketHandler()
    )
    const backingManager = await hre.ethers.getContractAt(
      'IBackingManager',
      await main.backingManager()
    )
    const broker = await hre.ethers.getContractAt('IBroker', await main.broker())
    const distributor = await hre.ethers.getContractAt('IDistributor', await main.distributor())
    const furnace = await hre.ethers.getContractAt('IFurnace', await main.furnace())
    const stRSR = await hre.ethers.getContractAt('IStRSR', await main.stRSR())
    const rsrTrader = await hre.ethers.getContractAt('IRevenueTrader', await main.rsrTrader())
    const rTokenTrader = await hre.ethers.getContractAt('IRevenueTrader', await main.rTokenTrader())
    await assetRegistry.refresh()
    if (!((await basketHandler.status()) == 0)) throw new Error('Basket is not SOUND')
    if (!(await basketHandler.fullyCollateralized())) {
      throw new Error('Basket is not fully collateralized')
    }
    console.log('💪 Basket is SOUND and fully collateralized!')
    console.log('\n', 'Basket:')
    const [primeBasketERC20s] = await basketHandler.getPrimeBasket()
    const [refBasketERC20s] = await basketHandler.quote(fp('1e18'), 0)
    if (primeBasketERC20s.length != refBasketERC20s.length) {
      throw new Error('Reference basket length != prime basket length')
    }
    for (let i = 0; i < primeBasketERC20s.length; i++) {
      if (primeBasketERC20s[i] != refBasketERC20s[i]) {
        throw new Error(`ref erc20 ${refBasketERC20s[i]} != prime erc20 ${primeBasketERC20s[i]}`)
      }
      const erc20 = await hre.ethers.getContractAt('IERC20Metadata', primeBasketERC20s[i])
      const asset = await hre.ethers.getContractAt(
        'IVersioned',
        await assetRegistry.toAsset(primeBasketERC20s[i])
      )
      console.log(
        `  ${i + 1}: ${await erc20.symbol()} ${await asset.version()} (${primeBasketERC20s[i]})`
      )
    }

    console.log('\n', 'Core Contracts')
    console.log('  - main:', await main.version())
    console.log('  - assetRegistry:', await assetRegistry.version())
    console.log('  - basketHandler:', await basketHandler.version())
    console.log('  - backingManager:', await backingManager.version())
    console.log('  - broker:', await broker.version())
    console.log('  - distributor:', await distributor.version())
    console.log('  - furnace:', await furnace.version())
    console.log('  - stRSR:', await stRSR.version())
    console.log('  - rsrTrader:', await rsrTrader.version())
    console.log('  - rTokenTrader:', await rTokenTrader.version())
    console.log('  - rToken:', await rToken.version())

    const [erc20s, assets] = await assetRegistry.getRegistry()
    console.log('\n', `Assets (${assets.length})`)
    const targetNames: string[] = []
    for (let i = 0; i < assets.length; i++) {
      const erc20 = await hre.ethers.getContractAt('IERC20Metadata', erc20s[i])
      const asset = await hre.ethers.getContractAt('IVersioned', assets[i])
      console.log(`  - ${await erc20.symbol()}: ${await asset.version()}`)

      const coll = await hre.ethers.getContractAt('ICollateral', assets[i])
      if (!(await coll.isCollateral())) continue

      const targetName = await coll.targetName()
      if (!targetNames.includes(targetName)) {
        targetNames.push(targetName)
      }
    }

    for (const targetName of targetNames) {
      const [backupERC20s] = await basketHandler.getBackupConfig(targetName)
      console.log('\n', `Backup Config (${targetName})`)
      for (let i = 0; i < backupERC20s.length; i++) {
        const erc20 = await hre.ethers.getContractAt('IERC20Metadata', backupERC20s[i])
        const isRegistered = await assetRegistry.isRegistered(backupERC20s[i])

        if (!isRegistered) {
          console.log(`  - ${await erc20.symbol()}: NOT REGISTERED`)
        } else {
          const assetAddr = await assetRegistry.toAsset(erc20.address)
          const asset = await hre.ethers.getContractAt('IVersioned', assetAddr)
          console.log(`  - ${await erc20.symbol()}: ${await asset.version()} `)
        }
      }
    }
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
    await advanceTime(hre, (await basketHandler.warmupPeriod()) + 1)
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
    const redeemAmt = fp('100')
    await whileImpersonating(hre, whales[params.rtoken.toLowerCase()], async (whaleSigner) => {
      await rToken.connect(whaleSigner).transfer(tester.address, redeemAmt)
    })
    if (!(await rToken.balanceOf(tester.address)).gte(redeemAmt)) throw new Error('missing RToken')

    await runCheck_redeem(hre, tester, rToken.address, redeemAmt)

    /*
      mint the redeemed amount
    */
    const mintAmt = redeemAmt.mul(999).div(1000)
    await runCheck_mint(hre, mintAmt, tester, basketHandler, rToken)

    /*
      claim rewards
    */

    await rToken.connect(tester).transfer(await main.rsrTrader(), mintAmt.div(10))
    await processRevenue(hre, params.rtoken)

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
    whales[networkConfig[chainId].tokens.RSR!.toLowerCase()],
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

  // Unstake and withdraw
  await unstakeAndWithdrawRsr(hre, rToken.address, tester.address)

  console.log('Successfully staked and unstaked RSR')
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
  const [erc20s] = await basketHandler.quote(fp('1'), 2)
  for (let i = 0; i < erc20s.length; i++) {
    const erc20 = await hre.ethers.getContractAt(
      '@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20',
      erc20s[i]
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

task('save-proposal-pt-2')
  .addParam('rtoken', 'the address of the RToken being upgraded')
  .addParam('gov', 'the address of the OWNER of the RToken being upgraded')
  .addParam('time', 'the address of the timelock')
  .setAction(async (params, hre) => {
    const chainId = await getChainId(hre)

    // make sure config exists
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }

    const spellAddr =
      chainId == '1'
        ? '0xb1df3a104d73ff86f9aaab60b491a5c44b090391'
        : '0x1744c9933feb8e76563fce63d5c95a4e7f967c2a'
    const proposal = await proposal_3_4_0_step_2(
      hre,
      params.rtoken,
      params.gov,
      params.time,
      spellAddr
    )

    console.log(`\nGenerating and hashing proposal...`)
    const governor = await hre.ethers.getContractAt('Governance', params.gov)

    const call = await governor.populateTransaction.propose(
      proposal.targets,
      proposal.values,
      proposal.calldatas,
      proposal.description
    )

    console.log(`Proposal Transaction:\n`, call.data)

    const proposalId = await governor.hashProposal(
      proposal.targets,
      proposal.values,
      proposal.calldatas,
      hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes(proposal.description))
    )

    console.log(`Proposal ID: ${proposalId}`)
    proposal.proposalId = proposalId.toString()
    proposal.governor = params.gov
    proposal.timelock = params.time
    proposal.rtoken = params.rtoken

    fs.writeFileSync(
      `./tasks/validation/proposals/proposal-${proposal.proposalId}.json`,
      JSON.stringify(proposal, null, 2)
    )

    console.log("Saved to proposals folder. Don't forget to run `proposal-validator`!")
  })
