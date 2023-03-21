import { task, types } from 'hardhat/config'
import { networkConfig } from '../../common/configuration'
import { getChainId } from '../../common/blockchain-utils'
import { advanceBlocks, advanceTime, getLatestBlockTimestamp } from '#/utils/time'
import { whileImpersonating } from '#/utils/impersonation';
import { ProposalState, QUEUE_START } from '#/common/constants'
import { BigNumber, ContractFactory, utils } from 'ethers'
import { Proposal, getProposalDetails, getDelegates, Delegate } from '../../utils/subgraph'
import { useEnv } from '#/utils/env';
import { resetFork } from '#/utils/chain';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { bn, fp, toBNDecimals } from '#/common/numbers';
import { formatEther, parseEther, formatUnits, parseUnits } from 'ethers/lib/utils';
import { FacadeTest } from '@typechain/FacadeTest';
import { getTrade } from '#/utils/trades'
import { IRewardable } from '@typechain/IRewardable';

// run script for eUSD
// current proposal id is to test passing a past proposal (broker upgrade proposal id will be different)
// npx hardhat upgrade-checker --rtoken 0xA0d69E286B938e21CBf7E51D71F6A4c8918f482F --governor 0x7e880d8bD9c9612D6A9759F96aCD23df4A4650E6 --proposal 51110366224941500632568067966420116363657831627221850780259437481890922983943 --network localhost

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

        if (hre.network.name != 'localhost' && hre.network.name != 'hardhat') {
            throw new Error('Only run this on a local fork')
        }

        // 1. Approve and execute the govnerance proposal
        // await passAndExecuteProposal(hre, params.rtoken, params.governor, params.proposal)

        // 2. Run various checks
        const saUsdtAddress = '0x21fe646D1Ed0733336F2D4d9b2FE67790a6099D9'
        const cUsdtAddress = '0xf650C3d88D12dB855b8bf7D11Be6C55A4e07dCC9'
        const usdtAddress = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
        const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
        const holderUSDT = '0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503'
        const rsrWhale = '0x6bab6EB87Aa5a1e4A8310C73bDAAA8A5dAAd81C1'

        const rToken = await hre.ethers.getContractAt('RTokenP1', params.rtoken)
        const main = await hre.ethers.getContractAt('IMain', await rToken.main())
        const basketHandler = await hre.ethers.getContractAt('BasketHandlerP1', await main.basketHandler())
        const backingManager = await hre.ethers.getContractAt('BackingManagerP1', await main.backingManager())
        const FacadeTestFactory: ContractFactory = await hre.ethers.getContractFactory('FacadeTest')
        const facadeTest = <FacadeTest>await FacadeTestFactory.deploy()
        const rsrTrader = await hre.ethers.getContractAt('RevenueTraderP1', await main.rsrTrader())
        const rTokenTrader = await hre.ethers.getContractAt('RevenueTraderP1', await main.rTokenTrader())
        const rsr = await hre.ethers.getContractAt('ERC20Mock', await main.rsr())
        
        
        // recollateralize
        // here we will make any trades needed to recollateralize the RToken
        // this is specific to eUSD so that we don't have to wait for the market to do this
        // we can make this generic, but will leave it specific for now for testing the upcoming eUSD changes

        await facadeTest.runAuctionsForAllTraders(rToken.address)
        const trade = await getTrade(hre, backingManager, rsr.address)
        const endTime = await trade.endTime()
        const worstPrice = await trade.worstCasePrice()
        const auctionId = await trade.auctionId()
        const buyAmount = await trade.initBal()
        const sellAmount = buyAmount.mul(worstPrice).div(fp('1')).add(fp('1'))
    
        const gnosis = await hre.ethers.getContractAt('EasyAuction', await trade.gnosis())
        await whileImpersonating(hre, rsrWhale, async (whale) => {
            await rsr.connect(whale).approve(gnosis.address, sellAmount)
            await gnosis.connect(whale).placeSellOrders(
                auctionId,
                [buyAmount],
                [sellAmount],
                [QUEUE_START],
                hre.ethers.constants.HashZero
            )
        })
    
        const lastTimestamp = await getLatestBlockTimestamp(hre)
        await advanceTime(hre, BigNumber.from(endTime).sub(lastTimestamp).toString())
    
        await rsrTrader.settleTrade(rsr.address)
        await facadeTest.runAuctionsForAllTraders(rToken.address)

        console.log('successfully settled trade')


        // mint
        // this is another area that needs to be made general
        // for now, we just want to be able to test eUSD, so minting and redeeming eUSD is fine

        /*
        const initialBal = bn('2e11')
        const issueAmount = fp('1e5')
        const usdt = await hre.ethers.getContractAt('ERC20Mock', usdtAddress)
        const saUsdt = await hre.ethers.getContractAt('StaticATokenLM', saUsdtAddress)
        const cUsdt = await hre.ethers.getContractAt('ICToken', cUsdtAddress)

        await whileImpersonating(hre, holderUSDT, async (usdtSigner) => {
            await usdt.connect(usdtSigner).approve(saUsdt.address, initialBal) 
            await saUsdt.connect(usdtSigner).deposit(tester.address, initialBal, 0, true)
        })
        await saUsdt.connect(tester).approve(rToken.address, initialBal)

        await whileImpersonating(hre, holderUSDT, async (usdtSigner) => {
            await usdt.connect(usdtSigner).approve(cUsdt.address, initialBal) 
            await cUsdt.connect(usdtSigner).mint(initialBal)
            const bal = await cUsdt.balanceOf(usdtSigner.address)
            await cUsdt.connect(usdtSigner).transfer(tester.address, bal)
        })
        await cUsdt.connect(tester).approve(rToken.address, initialBal)

        await whileImpersonating(hre, holderUSDT, async (usdtSigner) => {
            await usdt.connect(usdtSigner).transfer(tester.address, initialBal)
        })
        await usdt.connect(tester).approve(rToken.address, initialBal)
        
        await rToken.connect(tester).issue(issueAmount)
        const postIssueBal = await rToken.balanceOf(tester.address)
        if (postIssueBal != issueAmount) {
            throw new Error(`Did not issue the correct amount of RTokens. wanted: ${formatUnits(issueAmount, 'mwei')}    balance: ${formatUnits(postIssueBal, 'mwei')}`)
        }

        // redeem
        const redeemAmount = fp('5e4')

        await rToken.connect(tester).redeem(redeemAmount, await basketHandler.nonce())

        const postRedeemBal = await rToken.balanceOf(tester.address)
        if (postRedeemBal != fp('5e4')) {
            throw new Error("Did not redeem the correct amount of RTokens")
        }
        */

        // claim rewards
        await claimRsrRewards(hre, params.rtoken)

        // switch basket
        await whileImpersonating(hre, params.governor, async (gov) => {
            await basketHandler.connect(gov).setPrimeBasket(
                [saUsdtAddress, cUsdtAddress, usdcAddress],
                [25, 25, 50]
            )
        })
    })

const claimRewards = async (
    claimer: IRewardable
) => {
    const resp = await claimer.claimRewards()
    const r = await resp.wait()
    const rewards = []
    for (const event of r.events!) {
        if (event.event == 'RewardsClaimed' && event.args!.amount.gt(0)) {
            rewards.push(event.args!.erc20)
        }
    }
    return rewards
}

const claimRsrRewards = async (
    hre: HardhatRuntimeEnvironment,
    rtokenAddress: string
) => {
    const rsrWhale = '0x6bab6EB87Aa5a1e4A8310C73bDAAA8A5dAAd81C1'
    const rToken = await hre.ethers.getContractAt('RTokenP1', rtokenAddress)
    const main = await hre.ethers.getContractAt('IMain', await rToken.main())
    const backingManager = await hre.ethers.getContractAt('BackingManagerP1', await main.backingManager())
    const rsrTrader = await hre.ethers.getContractAt('RevenueTraderP1', await main.rsrTrader())
    const rsr = await hre.ethers.getContractAt('ERC20Mock', await main.rsr())
    const strsr = await hre.ethers.getContractAt('StRSRP1', await main.stRSR())
    const rsrRatePre = await strsr.exchangeRate()

    const rewards = await claimRewards(backingManager)
    await backingManager.manageTokens(rewards)
    // for (const reward of rewards) {

    // }
    const comp = '0xc00e94Cb662C3520282E6f5717214004A7f26888'
    const compContract = await hre.ethers.getContractAt('ERC20Mock', comp)

    // fake enough rewards to trade
    await whileImpersonating(hre, '0x2775b1c75658Be0F640272CCb8c72ac986009e38', async (compWhale) => {
        await compContract.connect(compWhale).transfer(rsrTrader.address, fp('1e5'))
    })

    await rsrTrader.manageToken(comp)
    const trade = await getTrade(hre, rsrTrader, comp)
    const endTime = await trade.endTime()
    const worstPrice = await trade.worstCasePrice()
    const auctionId = await trade.auctionId()
    const buyAmount = await trade.initBal()
    const sellAmount = buyAmount.mul(worstPrice).div(fp('1')).add(fp('1'))

    const gnosis = await hre.ethers.getContractAt('EasyAuction', await trade.gnosis())
    await whileImpersonating(hre, rsrWhale, async (whale) => {
        await rsr.connect(whale).approve(gnosis.address, sellAmount)
        await gnosis.connect(whale).placeSellOrders(
            auctionId,
            [buyAmount],
            [sellAmount],
            [QUEUE_START],
            hre.ethers.constants.HashZero
        )
    })

    const lastTimestamp = await getLatestBlockTimestamp(hre)
    await advanceTime(hre, BigNumber.from(endTime).sub(lastTimestamp).toString())

    await rsrTrader.settleTrade(comp)
    await rsrTrader.manageToken(rsr.address)
    await strsr.payoutRewards()
    await advanceBlocks(hre, 100)
    await advanceTime(hre, 1200)
    await strsr.payoutRewards()

    const rsrRatePost = await strsr.exchangeRate()
    if (!rsrRatePost.gt(rsrRatePre)) {
        throw new Error(`stRSR rate should have increased. pre: ${formatEther(rsrRatePre)}   post ${formatEther(rsrRatePost)}`)
    }
}

const passAndExecuteProposal = async (
    hre: HardhatRuntimeEnvironment,
    rtokenAddress: string,
    governorAddress: string,
    proposalId: string
) => {
    const governor = await hre.ethers.getContractAt('Governance', governorAddress)

    // Check proposal state
    let propState = await governor.state(proposalId)
    if (propState != ProposalState.Pending) {
        throw new Error(`Proposal should be pending but was ${propState}`)
    }

    // Advance time to start voting
    const votingDelay = await governor.votingDelay()
    await advanceBlocks(hre, votingDelay.add(1))

    // Check proposal state
    propState = await governor.state(proposalId)
    if (propState != ProposalState.Active) {
        throw new Error(`Proposal should be active but was ${propState}`)
    }

    // gather enough whale voters
    let whales: Array<Delegate> = await getDelegates(hre, rtokenAddress.toLowerCase())
    const startBlock = await governor.proposalSnapshot(proposalId)
    const quorum = await governor.quorum(startBlock)

    let quorumNotReached = true
    let currentVoteAmount = BigNumber.from(0)
    let i = 0
    while (quorumNotReached) {
        const whale = whales[i]
        currentVoteAmount = currentVoteAmount.add(BigNumber.from(whale.delegatedVotesRaw))
        i += 1
        if (currentVoteAmount.gt(quorum)) {
            quorumNotReached = false
        }
    }

    whales = whales.slice(0, i)

    // cast enough votes to pass the proposal
    for (const whale of whales) {
        await whileImpersonating(hre, whale.address, async (signer) => {
            await governor.connect(signer).castVote(proposalId, 1)
        })
    }
    
    // Advance time till voting is complete
    const votingPeriod = await governor.votingPeriod()
    await advanceBlocks(hre, votingPeriod.add(1))

    // Finished voting - Check proposal state
    if (await governor.state(proposalId) != ProposalState.Succeeded) {
        throw new Error("Proposal should have succeeded")
    }

    const proposal: Proposal = await getProposalDetails(hre, `${governorAddress.toLowerCase()}-${proposalId}`)
    const descriptionHash = hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes(proposal.description))
    // Queue propoal
    await governor.queue(
        proposal.targets,
        proposal.values,
        proposal.calldatas,
        descriptionHash
    )

    // Check proposal state
    if (await governor.state(proposalId) != ProposalState.Queued) {
        throw new Error("Proposal should be queued")
    }

    const timelock = await hre.ethers.getContractAt('TimelockController', await governor.timelock())
    const minDelay = await timelock.getMinDelay()

    // Advance time required by timelock
    await advanceTime(hre, minDelay.add(1).toString())
    await advanceBlocks(hre, 1)

    // Execute
    await governor.execute(
        proposal.targets,
        proposal.values,
        proposal.calldatas,
        descriptionHash
    )

    // Check proposal state
    if (await governor.state(proposalId) != ProposalState.Executed) {
        throw new Error("Proposal should be executed")
    }
}