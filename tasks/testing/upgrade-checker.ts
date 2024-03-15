import { task } from 'hardhat/config'
import { networkConfig } from '../../common/configuration'
import { getChainId } from '../../common/blockchain-utils'
import { whileImpersonating } from '#/utils/impersonation'
import { useEnv } from '#/utils/env'
import { expect } from 'chai'
import { fp } from '#/common/numbers'
import { MAX_UINT256, TradeKind } from '#/common/constants'
import { formatEther, formatUnits } from 'ethers/lib/utils'
import { recollateralize, redeemRTokens } from './upgrade-checker-utils/rtokens'
import { claimRsrRewards } from './upgrade-checker-utils/rewards'
import { whales } from './upgrade-checker-utils/constants'
import runChecks3_3_0, {
  proposal_3_3_0_step_1,
  proposal_3_3_0_step_2,
  proposal_3_3_0_step_3,
  proposal_3_3_0_step_4,
} from './upgrade-checker-utils/upgrades/3_3_0_plugins'
import {
  passAndExecuteProposal,
  proposeUpgrade,
  stakeAndDelegateRsr,
} from './upgrade-checker-utils/governance'
import { advanceTime, getLatestBlockNumber } from '#/utils/time'

// run script for eUSD (version 3.3.0)
// npx hardhat upgrade-checker --rtoken 0xA0d69E286B938e21CBf7E51D71F6A4c8918f482F --governor 0x7e880d8bD9c9612D6A9759F96aCD23df4A4650E6

/*
  This script is currently useful for the upcoming eUSD upgrade.
  In order to make this useful for future upgrades and for other rTokens, we will need the following:
    - generic minting (5 pts)
      - dynamically gather and approve the necessary basket tokens needed to mint
      - use ZAPs
    - generic reward claiming (5 pts)
      - check for where revenue should be allocated
      - dynamically run and complete necessary auctions to realize revenue
    - generic basket switching (8 pts)
      - not sure if possible if there is no backup basket

  21-34 more points of work to make this more generic
*/

interface Params {
  rtoken: string
  governor: string
  proposalId?: string
}

task('upgrade-checker', 'Runs a proposal and confirms can fully rebalance + redeem + mint')
  .addParam('rtoken', 'the address of the RToken being upgraded')
  .addParam('governor', 'the address of the OWNER of the RToken being upgraded')
  .addOptionalParam('proposalId', 'the ID of the governance proposal', undefined)
  .setAction(async (params: Params, hre) => {
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
    if (params.proposalId && !useEnv('SUBGRAPH_URL')) {
      throw new Error('SUBGRAPH_URL required for subgraph queries')
    }

    console.log(`Network Block: ${await getLatestBlockNumber(hre)}`)

    await hre.run('propose', {
      step: '1',
      rtoken: params.rtoken,
      governor: params.governor,
    })

    await hre.run('recollateralize', {
      rtoken: params.rtoken,
      governor: params.governor,
    })

    await hre.run('propose', {
      step: '2',
      rtoken: params.rtoken,
      governor: params.governor,
    })

    await hre.run('recollateralize', {
      rtoken: params.rtoken,
      governor: params.governor,
    })

    await hre.run('propose', {
      step: '3',
      rtoken: params.rtoken,
      governor: params.governor,
    })

    await hre.run('recollateralize', {
      rtoken: params.rtoken,
      governor: params.governor,
    })

    await hre.run('propose', {
      step: '4',
      rtoken: params.rtoken,
      governor: params.governor,
    })

    const rToken = await hre.ethers.getContractAt('IRToken', params.rtoken)
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
  step: string
  rtoken: string
  governor: string
  proposalId?: string
}

task('propose', 'propose a gov action')
  .addParam('step', 'the step of the proposal')
  .addParam('rtoken', 'the address of the RToken being upgraded')
  .addParam('governor', 'the address of the OWNER of the RToken being upgraded')
  .setAction(async (params: ProposeParams, hre) => {
    const stepFunction = (() => {
      console.log(`=========================== STEP ${params.step} ===============================`)
      if (params.step === '1') {
        return proposal_3_3_0_step_1
      }
      if (params.step === '2') {
        return proposal_3_3_0_step_2
      }
      if (params.step === '3') {
        return proposal_3_3_0_step_3
      }
      if (params.step === '4') {
        return proposal_3_3_0_step_4
      }

      throw Error('Invalid step')
    })()

    const proposal = await proposeUpgrade(hre, params.rtoken, params.governor, stepFunction)
    await passAndExecuteProposal(hre, params.rtoken, params.governor, proposal.proposalId, proposal)
  })

task('recollateralize')
  .addParam('rtoken', 'the address of the RToken being upgraded')
  .addParam('governor', 'the address of the OWNER of the RToken being upgraded')
  .setAction(async (params: Params, hre) => {
    const [tester] = await hre.ethers.getSigners()
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
    // const broker = await hre.ethers.getContractAt('BrokerP1', await main.broker())
    const stRSR = await hre.ethers.getContractAt('StRSRP1Votes', await main.stRSR())

    /*
      recollateralize
    */
    await advanceTime(hre, (await backingManager.tradingDelay()) + 1)
    await recollateralize(hre, rToken.address, TradeKind.DUTCH_AUCTION).catch((e: Error) => {
      if (e.message.includes('already collateralized')) {
        console.log('Already Collateralized!')

        return
      }

      throw e
    })
    if (!(await basketHandler.fullyCollateralized())) throw new Error('Failed to recollateralize')

    // Give `tester` RTokens from Base bridge
    const redeemAmt = fp('1e3')
    await whileImpersonating(
      hre,
      '0x3154Cf16ccdb4C6d922629664174b904d80F2C35', // base bridge address on mainnet
      async (baseBridge) => {
        await rToken.connect(baseBridge).transfer(tester.address, redeemAmt)
      }
    )
    if (!(await rToken.balanceOf(tester.address)).gte(redeemAmt)) throw new Error('missing R')

    /*
      redeem
    */
    await redeemRTokens(hre, tester, params.rtoken, redeemAmt)

    // 3. Run the 3.0.0 checks
    await runChecks3_3_0(hre, params.rtoken, params.governor)

    /*
      mint
    */

    const issueAmt = redeemAmt.div(2)
    console.log(`\nIssuing  ${formatEther(issueAmt)} RTokens...`)
    const [erc20s] = await basketHandler.quote(fp('1'), 0)
    for (const e of erc20s) {
      const erc20 = await hre.ethers.getContractAt(
        '@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20',
        e
      )
      await erc20.connect(tester).approve(rToken.address, MAX_UINT256) // max approval
    }
    const preBal = await rToken.balanceOf(tester.address)
    await rToken.connect(tester).issue(issueAmt)

    const postIssueBal = await rToken.balanceOf(tester.address)
    if (!postIssueBal.eq(preBal.add(issueAmt))) {
      throw new Error(
        `Did not issue the correct amount of RTokens. wanted: ${formatUnits(
          preBal.add(issueAmt),
          'mwei'
        )}    balance: ${formatUnits(postIssueBal, 'mwei')}`
      )
    }

    console.log('Successfully minted RTokens')

    /*
      claim rewards
    */
    await claimRsrRewards(hre, params.rtoken)

    /*
      staking/unstaking
    */

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
  })

task('hyusd-test', 'propose a gov action').setAction(async (params: ProposeParams, hre) => {
  const [tester] = await hre.ethers.getSigners()

  await hre.run('give-rsr', { address: tester.address })
  await stakeAndDelegateRsr(hre, '0xacdf0dba4b9839b96221a8487e9ca660a48212be', tester.address)

  await passAndExecuteProposal(
    hre,
    '0xacdf0dba4b9839b96221a8487e9ca660a48212be',
    '0x22d7937438b4bBf02f6cA55E3831ABB94Bd0b6f1',
    '56375661373325357163307105282637191906372195918163014747036462170506704909512',
    undefined,
    ['0xCFA67f42A0fDe4F0Fb612ea5e66170B0465B84c1', '0x7Dee4DbeF75f93cCA06823Ac915Df990be3F1538']
  )

  await hre.run('recollateralize', {
    rtoken: params.rtoken,
    governor: params.governor,
  })
})

task('eusd-q1-2024-test', 'Test deployed eUSD Proposals').setAction(async (_, hre) => {
  await passAndExecuteProposal(
    hre,
    '0xa0d69e286b938e21cbf7e51d71f6a4c8918f482f',
    '0x7e880d8bD9c9612D6A9759F96aCD23df4A4650E6',
    '114052081659629247617665835769035094910371266951213483500173240902265689564540'
  )

  await hre.run('recollateralize', {
    rtoken: '0xa0d69e286b938e21cbf7e51d71f6a4c8918f482f',
    governor: '0x7e880d8bD9c9612D6A9759F96aCD23df4A4650E6',
  })

  await passAndExecuteProposal(
    hre,
    '0xa0d69e286b938e21cbf7e51d71f6a4c8918f482f',
    '0x7e880d8bD9c9612D6A9759F96aCD23df4A4650E6',
    '84013999114211651083886802889501217056607481369823717462033802424606122383108'
  )

  await hre.run('recollateralize', {
    rtoken: '0xa0d69e286b938e21cbf7e51d71f6a4c8918f482f',
    governor: '0x7e880d8bD9c9612D6A9759F96aCD23df4A4650E6',
  })
})
