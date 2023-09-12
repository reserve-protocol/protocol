import { task } from 'hardhat/config'
import { networkConfig } from '../../common/configuration'
import { getChainId } from '../../common/blockchain-utils'
import { whileImpersonating } from '#/utils/impersonation'
import { useEnv } from '#/utils/env'
import { expect } from 'chai'
import { resetFork } from '#/utils/chain'
import { bn, fp } from '#/common/numbers'
import { TradeKind } from '#/common/constants'
import { formatEther, formatUnits } from 'ethers/lib/utils'
import { pushOraclesForward } from './upgrade-checker-utils/oracles'
import {
  recollateralize,
  redeemRTokens,
  customRedeemRTokens,
} from './upgrade-checker-utils/rtokens'
import { claimRsrRewards } from './upgrade-checker-utils/rewards'
import { whales } from './upgrade-checker-utils/constants'
import runChecks3_0_0, { proposal_3_0_0 } from './upgrade-checker-utils/upgrades/3_0_0'
import {
  passAndExecuteProposal,
  proposeUpgrade,
  stakeAndDelegateRsr,
} from './upgrade-checker-utils/governance'
import { advanceBlocks, advanceTime, getLatestBlockNumber } from '#/utils/time'

// run script for eUSD (version 3.0.0)
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

task('upgrade-checker', 'Mints all the tokens to an address')
  .addParam('rtoken', 'the address of the RToken being upgraded')
  .addParam('governor', 'the address of the OWNER of the RToken being upgraded')
  .addOptionalParam('proposalid', 'the ID of the governance proposal', undefined)
  .setAction(async (params, hre) => {
    await resetFork(hre, Number(useEnv('MAINNET_BLOCK')))
    const [tester] = await hre.ethers.getSigners()

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
    if (!useEnv('SUBGRAPH_URL')) {
      throw new Error('SUBGRAPH_URL required for subgraph queries')
    }

    console.log(`starting at block ${await getLatestBlockNumber(hre)}`)

    // 1. Approve and execute the governance proposal
    if (!params.proposalid) {
      const proposal = await proposeUpgrade(hre, params.rtoken, params.governor, proposal_3_0_0)

      await passAndExecuteProposal(
        hre,
        params.rtoken,
        params.governor,
        proposal.proposalId!,
        proposal
      )
    } else {
      await passAndExecuteProposal(hre, params.rtoken, params.governor, params.proposalid)
    }

    // we pushed the chain forward, so we need to keep the rToken SOUND
    await pushOraclesForward(hre, params.rtoken)

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
    const broker = await hre.ethers.getContractAt('BrokerP1', await main.broker())
    const stRSR = await hre.ethers.getContractAt('StRSRP1Votes', await main.stRSR())

    // Move past trading delay
    await advanceTime(hre, (await backingManager.tradingDelay()) + 1)

    await recollateralize(
      hre,
      rToken.address,
      (await broker.dutchAuctionLength()) > 0 ? TradeKind.DUTCH_AUCTION : TradeKind.BATCH_AUCTION
    )

    // 3. Run various checks
    const saUsdtAddress = '0x21fe646D1Ed0733336F2D4d9b2FE67790a6099D9'.toLowerCase()
    const saUsdcAddress = '0x60C384e226b120d93f3e0F4C502957b2B9C32B15'.toLowerCase()
    const usdtAddress = networkConfig['1'].tokens.USDT!
    const usdcAddress = networkConfig['1'].tokens.USDC!
    const cUsdtAddress = networkConfig['1'].tokens.cUSDT!
    const cUsdcAddress = networkConfig['1'].tokens.cUSDC!
    const cUsdtVaultAddress = '0x4Be33630F92661afD646081BC29079A38b879aA0'.toLowerCase()
    const cUsdcVaultAddress = '0xf579F9885f1AEa0d3F8bE0F18AfED28c92a43022'.toLowerCase()

    /*

      mint

     this is another area that needs to be made general
     for now, we just want to be able to test eUSD, so minting and redeeming eUSD is fine

    */

    const initialBal = bn('2e11')
    const issueAmount = fp('1e5')
    const usdt = await hre.ethers.getContractAt('ERC20Mock', usdtAddress)
    const usdc = await hre.ethers.getContractAt('ERC20Mock', usdcAddress)
    const saUsdt = await hre.ethers.getContractAt('StaticATokenLM', saUsdtAddress)
    const cUsdt = await hre.ethers.getContractAt('ICToken', cUsdtAddress)
    const cUsdtVault = await hre.ethers.getContractAt('CTokenWrapper', cUsdtVaultAddress)
    const saUsdc = await hre.ethers.getContractAt('StaticATokenLM', saUsdcAddress)
    const cUsdc = await hre.ethers.getContractAt('ICToken', cUsdcAddress)
    const cUsdcVault = await hre.ethers.getContractAt('CTokenWrapper', cUsdcVaultAddress)

    // get saUsdt
    await whileImpersonating(
      hre,
      whales[networkConfig['1'].tokens.USDT!.toLowerCase()],
      async (usdtSigner) => {
        await usdt.connect(usdtSigner).approve(saUsdt.address, initialBal)
        await saUsdt.connect(usdtSigner).deposit(tester.address, initialBal, 0, true)
      }
    )
    const saUsdtBal = await saUsdt.balanceOf(tester.address)
    await saUsdt.connect(tester).approve(rToken.address, saUsdtBal)

    // get cUsdtVault
    await whileImpersonating(
      hre,
      whales[networkConfig['1'].tokens.USDT!.toLowerCase()],
      async (usdtSigner) => {
        await usdt.connect(usdtSigner).approve(cUsdt.address, initialBal)
        await cUsdt.connect(usdtSigner).mint(initialBal)
        const bal = await cUsdt.balanceOf(usdtSigner.address)
        await cUsdt.connect(usdtSigner).approve(cUsdtVault.address, bal)
        await cUsdtVault.connect(usdtSigner).deposit(bal, tester.address)
      }
    )

    const cUsdtVaultBal = await cUsdtVault.balanceOf(tester.address)
    await cUsdtVault.connect(tester).approve(rToken.address, cUsdtVaultBal)

    // get saUsdc
    await whileImpersonating(
      hre,
      whales[networkConfig['1'].tokens.USDC!.toLowerCase()],
      async (usdcSigner) => {
        await usdc.connect(usdcSigner).approve(saUsdc.address, initialBal)
        await saUsdc.connect(usdcSigner).deposit(tester.address, initialBal, 0, true)
      }
    )
    const saUsdcBal = await saUsdc.balanceOf(tester.address)
    await saUsdc.connect(tester).approve(rToken.address, saUsdcBal)

    // get cUsdcVault
    await whileImpersonating(
      hre,
      whales[networkConfig['1'].tokens.USDC!.toLowerCase()],
      async (usdcSigner) => {
        await usdc.connect(usdcSigner).approve(cUsdc.address, initialBal)
        await cUsdc.connect(usdcSigner).mint(initialBal)
        const bal = await cUsdc.balanceOf(usdcSigner.address)
        await cUsdc.connect(usdcSigner).approve(cUsdcVault.address, bal)
        await cUsdcVault.connect(usdcSigner).deposit(bal, tester.address)
      }
    )
    const cUsdcVaultBal = await cUsdcVault.balanceOf(tester.address)
    await cUsdcVault.connect(tester).approve(rToken.address, cUsdcVaultBal)

    console.log(`\nIssuing  ${formatEther(issueAmount)} RTokens...`)
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

    /*

      redeem

    */
    const redeemAmount = fp('5e4')
    await redeemRTokens(hre, tester, params.rtoken, redeemAmount)

    // 3. Run the 3.0.0 checks
    await pushOraclesForward(hre, params.rtoken)
    await runChecks3_0_0(hre, params.rtoken, params.governor)

    // we pushed the chain forward, so we need to keep the rToken SOUND
    await pushOraclesForward(hre, params.rtoken)

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

    await stakeAndDelegateRsr(hre, rToken.address, tester.address)

    expect(await rsr.balanceOf(stRSR.address)).to.equal(balPrevRSR.add(stakeAmount))
    expect(await stRSR.balanceOf(tester.address)).to.be.gt(balPrevStRSR)

    /*

      switch basket and recollateralize - using Batch Auctions
      Also check for custom redemption

    */

    // we pushed the chain forward, so we need to keep the rToken SOUND
    await pushOraclesForward(hre, params.rtoken)

    const bas = await basketHandler.getPrimeBasket()
    console.log(bas.erc20s)

    const prevNonce = await basketHandler.nonce()
    const governor = await hre.ethers.getContractAt('Governance', params.governor)
    const timelockAddress = await governor.timelock()
    await whileImpersonating(hre, timelockAddress, async (tl) => {
      await basketHandler
        .connect(tl)
        .setPrimeBasket([saUsdtAddress, cUsdtVaultAddress], [fp('0.5'), fp('0.5')])
      await basketHandler.connect(tl).refreshBasket()
      const tradingDelay = await backingManager.tradingDelay()
      await advanceBlocks(hre, tradingDelay / 12 + 1)
      await advanceTime(hre, tradingDelay + 1)
    })

    const b = await basketHandler.getPrimeBasket()
    console.log(b.erc20s)

    /*
       custom redemption
    */
    // Cannot do normal redeem
    expect(await basketHandler.fullyCollateralized()).to.equal(false)
    await expect(rToken.connect(tester).redeem(redeemAmount)).to.be.revertedWith(
      'partial redemption; use redeemCustom'
    )

    // Do custom redemption on previous basket
    await customRedeemRTokens(hre, tester, params.rtoken, prevNonce, redeemAmount)

    // Recollateralize using Batch auctions
    await recollateralize(hre, rToken.address, TradeKind.BATCH_AUCTION)
  })

task('propose', 'propose a gov action')
  .addParam('rtoken', 'the address of the RToken being upgraded')
  .addParam('governor', 'the address of the OWNER of the RToken being upgraded')
  .setAction(async (params, hre) => {
    await proposeUpgrade(hre, params.rtoken, params.governor, proposal_3_0_0)
  })
