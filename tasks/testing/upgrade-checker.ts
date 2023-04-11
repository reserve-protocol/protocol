import { task } from 'hardhat/config'
import { networkConfig } from '../../common/configuration'
import { getChainId } from '../../common/blockchain-utils'
import { whileImpersonating } from '#/utils/impersonation'
import { ContractFactory } from 'ethers'
import { useEnv } from '#/utils/env'
import { resetFork } from '#/utils/chain'
import { bn, fp } from '#/common/numbers'
import { formatEther, formatUnits } from 'ethers/lib/utils'
import { FacadeTest } from '@typechain/FacadeTest'
import { pushOraclesForward } from './upgrade-checker-utils/oracles'
import { redeemRTokens } from './upgrade-checker-utils/rtokens'
import { claimRsrRewards } from './upgrade-checker-utils/rewards'
import { whales } from './upgrade-checker-utils/constants'
import { runTrade } from './upgrade-checker-utils/trades'
import runChecks2_1_0, { proposal_2_1_0 } from './upgrade-checker-utils/upgrades/2_1_0'
import { passAndExecuteProposal, proposeUpgrade, stakeAndDelegateRsr } from './upgrade-checker-utils/governance'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { getLatestBlockNumber } from '#/utils/time'
import { Proposal } from '#/utils/subgraph'

// run script for eUSD
// current proposal id is to test passing a past proposal (broker upgrade proposal id will be different)
// npx hardhat upgrade-checker --rtoken 0xA0d69E286B938e21CBf7E51D71F6A4c8918f482F --governor 0x7e880d8bD9c9612D6A9759F96aCD23df4A4650E6 --proposal 25816366707034079050811482613682060088827919577695117773877308143394113022827 --network localhost
//
// npx hardhat upgrade-checker --rtoken 0xA0d69E286B938e21CBf7E51D71F6A4c8918f482F --governor 0x7e880d8bD9c9612D6A9759F96aCD23df4A4650E6 --proposal 4444567576556684443782001443774813208623707478190954944832481687972571551950 --network tenderly

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

task('upgrade-checker', 'Mints all the tokens to an address')
  .addParam('rtoken', 'the address of the RToken being upgraded')
  .addParam('governor', 'the address of the OWNER of the RToken being upgraded')
  .addParam('proposal', 'the ID of the governance proposal')
  .setAction(async (params, hre) => {
    await resetFork(hre, Number(useEnv('MAINNET_BLOCK')))
    const [tester] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    // ********** Read config **********
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }

    // if (hre.network.name != 'localhost' && hre.network.name != 'hardhat') {
    //   throw new Error('Only run this on a local fork')
    // }

    if (!useEnv('SUBGRAPH_URL')) {
      throw new Error('SUBGRAPH_URL required for subgraph queries')
    }

    console.log(`starting at block ${await getLatestBlockNumber(hre)}`)

    const proposal = await proposeUpgrade(hre, params.rtoken, params.governor, proposal_2_1_0)

    // 1. Approve and execute the govnerance proposal
    await passAndExecuteProposal(hre, params.rtoken, params.governor, proposal.proposalId!, proposal)
    // await passAndExecuteProposal(hre, params.rtoken, params.governor, params.proposal)


    // 2. Run various checks
    const saUsdtAddress = '0x21fe646D1Ed0733336F2D4d9b2FE67790a6099D9'.toLowerCase()
    const cUsdtAddress = networkConfig['1'].tokens.cUSDT!
    const usdtAddress = networkConfig['1'].tokens.USDT!
    const usdcAddress = networkConfig['1'].tokens.USDC!

    const rToken = await hre.ethers.getContractAt('RTokenP1', params.rtoken)
    const main = await hre.ethers.getContractAt('IMain', await rToken.main())
    const basketHandler = await hre.ethers.getContractAt(
      'BasketHandlerP1',
      await main.basketHandler()
    )
    const backingManager = await hre.ethers.getContractAt(
      'BackingManagerP1',
      await main.backingManager()
    )
    const FacadeTestFactory: ContractFactory = await hre.ethers.getContractFactory('FacadeTest')
    const facadeTest = <FacadeTest>await FacadeTestFactory.deploy()
    const rsr = await hre.ethers.getContractAt('ERC20Mock', await main.rsr())
    const assetRegistry = await hre.ethers.getContractAt(
      'AssetRegistryP1',
      await main.assetRegistry()
    )

    // recollateralize
    // here we will make any trades needed to recollateralize the RToken
    // this is specific to eUSD so that we don't have to wait for the market to do this
    // we can make this generic, but will leave it specific for now for testing the upcoming eUSD changes

    // await facadeTest.runAuctionsForAllTraders(rToken.address)
    // await runTrade(hre, backingManager, rsr.address, false)
    // await facadeTest.runAuctionsForAllTraders(rToken.address)

    // console.log('successfully settled trade')

    // mint
    // this is another area that needs to be made general
    // for now, we just want to be able to test eUSD, so minting and redeeming eUSD is fine

    await pushOraclesForward(hre, params.rtoken)
    
    await claimRsrRewards(hre, params.rtoken)

    await pushOraclesForward(hre, params.rtoken)

    const initialBal = bn('2e11')
    const issueAmount = fp('1e5')
    const usdt = await hre.ethers.getContractAt('ERC20Mock', usdtAddress)
    const saUsdt = await hre.ethers.getContractAt('StaticATokenLM', saUsdtAddress)
    const cUsdt = await hre.ethers.getContractAt('ICToken', cUsdtAddress)

    await whileImpersonating(hre, whales[networkConfig['1'].tokens.USDT!], async (usdtSigner) => {
      await usdt.connect(usdtSigner).approve(saUsdt.address, initialBal)
      await saUsdt.connect(usdtSigner).deposit(tester.address, initialBal, 0, true)
    })
    const saUsdtBal = await saUsdt.balanceOf(tester.address)
    await saUsdt.connect(tester).approve(rToken.address, saUsdtBal)

    await whileImpersonating(hre, whales[networkConfig['1'].tokens.USDT!], async (usdtSigner) => {
      await usdt.connect(usdtSigner).approve(cUsdt.address, initialBal)
      await cUsdt.connect(usdtSigner).mint(initialBal)
      const bal = await cUsdt.balanceOf(usdtSigner.address)
      await cUsdt.connect(usdtSigner).transfer(tester.address, bal)
    })
    const cUsdtBal = await cUsdt.balanceOf(tester.address)
    await cUsdt.connect(tester).approve(rToken.address, cUsdtBal)

    await whileImpersonating(hre, whales[networkConfig['1'].tokens.USDT!], async (usdtSigner) => {
      await usdt.connect(usdtSigner).transfer(tester.address, initialBal)
    })
    await usdt.connect(tester).approve(rToken.address, initialBal)

    console.log(`issuing  ${formatEther(issueAmount)} RTokens...`)
    await rToken.connect(tester).issue(issueAmount)
    const postIssueBal = await rToken.balanceOf(tester.address)
    if (!postIssueBal.eq(issueAmount)) {
      throw new Error(
        `Did not issue the correct amount of RTokens. wanted: ${formatUnits(
          issueAmount,
          'mwei'
        )}    balance: ${formatUnits(postIssueBal, 'mwei')}`
      )
    }

    console.log('successfully minted RTokens')

    // redeem
    const redeemAmount = fp('5e4')
    await redeemRTokens(hre, tester, params.rtoken, redeemAmount)

    // claim rewards
    await claimRsrRewards(hre, params.rtoken)

    // switch basket
    // await whileImpersonating(hre, params.governor, async (gov) => {
    //   await basketHandler
    //     .connect(gov)
    //     .setPrimeBasket([saUsdtAddress, cUsdtAddress, usdcAddress], [25, 25, 50])
    // })
    // await basketHandler.refreshBasket()
    // const registeredERC20s = await assetRegistry.erc20s()
    // await backingManager.manageTokens(registeredERC20s)
    // await runTrade(hre, backingManager, usdtAddress, true)

    await runChecks2_1_0(hre, params.rtoken, params.governor)
  })

task('propose', 'propose a gov action')
  .addParam('rtoken', 'the address of the RToken being upgraded')
  .addParam('governor', 'the address of the OWNER of the RToken being upgraded')
  .setAction(async (params, hre) => {
    await proposeUpgrade(hre, params.rtoken, params.governor, proposal_2_1_0)
  })
