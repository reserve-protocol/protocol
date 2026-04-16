import { expect } from 'chai'
import hre, { ethers } from 'hardhat'
import { whileImpersonating } from '#/utils/impersonation'
import { advanceBlocks, advanceTime } from '#/utils/time'
import { formatEther } from 'ethers/lib/utils'
import { bn, fp } from '#/common/numbers'
import { ProposalState } from '#/common/constants'
import { pushOraclesForward } from '../../tasks/validation/utils/oracles'

/**
 * Deprecation Proposal Validation — on-chain proposal (post-submission)
 *
 * Template for validating a deprecation proposal AFTER it's been submitted on-chain.
 * Verifies the JSON matches the on-chain proposal ID, then advances the already-submitted
 * proposal through governance, executes it, and validates all post-conditions.
 *
 * === HOW TO ADAPT ===
 * 1. Set PROPOSAL_JSON to the path of your generated JSON
 * 2. Set PROPOSAL_ID to the real on-chain proposal ID
 * 3. Fill in the contract addresses (GOVERNOR, TIMELOCK, MAIN, RTOKEN, BROKER)
 * 4. Fill in role holders (PAUSERS, SHORT_FREEZERS, LONG_FREEZERS)
 * 5. Set RTOKEN_HOLDER to an address with RToken balance for redemption test
 * 6. Set RSR_WHALE or use StRSR delegation (see comments below)
 * 7. Adjust governor time advancement for your governor type (see below)
 * 8. Use a FORK_BLOCK where the proposal already exists on-chain
 *
 * === GOVERNOR TYPES ===
 * - Governance (Reserve):    time-based — advanceTime for delay, advanceBlocks for period
 * - Governor Anastasius:     time-based — advanceTime + advanceBlocks(2) for both
 * - Governor Alexios:        block-based — advanceBlocks for both
 *
 * === RUN ===
 *   PROTO=p1 FORK=1 FORK_NETWORK=<mainnet|base|arbitrum> FORK_BLOCK=<block> \
 *     npx hardhat test test/deprecation/deprecate-onchain-proposal.test.ts
 */

// ======================== CONFIGURE THESE ========================
// NOTE: PROPOSAL_JSON must match what was submitted on-chain. If the JSON was
// regenerated after submission (e.g. with new actions), the hash will differ.

const PROPOSAL_JSON = '../../scripts/deprecation/proposals/deprecate-dgnETH.json'
const PROPOSAL_ID = '47338979468772114877208030107250016310660136334776747135689847485470102343203'

// Contract addresses
const GOVERNOR = '0xb7cB3880564A1F8698018ECDc78972F93b2615e6'
const TIMELOCK = '0x05623fcEe6FB48b7C8058022C48A72dbce09878e'
const MAIN = '0x0A82c906E283FE813fa591D104E0Bfe75609cD35'
const RTOKEN = '0x005F893EcD7bF9667195642f7649DA8163e23658'
const BROKER = '0x9baDe46AC6b0c6e3460513Ec71e5B2636D8ddac0'

// Role holders to verify removal
const PAUSERS = [
  '0x9ca72f031f789f51bd35cc34583c7b7a7d0871a3',
  '0xd5fe2780eb882d1da78f2136b81c2a4395488c98',
]
const SHORT_FREEZERS = [
  '0x03d03a026e71979be3b08d44b01eae4c5ff9da99',
  '0x8785b3a82d1e3c067cee8ff830df56c78f13526d',
  '0x9ca72f031f789f51bd35cc34583c7b7a7d0871a3',
  '0xd5fe2780eb882d1da78f2136b81c2a4395488c98',
  '0xd733d4cc5b42206a62ed7b1ceec5b4d61898f429',
]
const LONG_FREEZERS = ['0xd5fe2780eb882d1da78f2136b81c2a4395488c98']

// RToken holder for redemption test — must have balance at the fork block
const RTOKEN_HOLDER = '0x9ca72f031f789f51bd35cc34583c7b7a7d0871a3'

// RSR whale for staking voting power (mainnet only — for Base/Arbitrum use StRSR delegation)
const RSR_WHALE = '0x6bab6EB87Aa5a1e4A8310C73bDAAA8A5dAAd81C1'

// ======================== END CONFIG ========================

const PAUSER_ROLE = '0x5041555345520000000000000000000000000000000000000000000000000000'
const SHORT_FREEZER_ROLE = '0x53484f52545f465245455a455200000000000000000000000000000000000000'
const LONG_FREEZER_ROLE = '0x4c4f4e475f465245455a45520000000000000000000000000000000000000000'
const OWNER_ROLE = '0x4f574e4552000000000000000000000000000000000000000000000000000000'

describe('Deprecation Proposal (on-chain)', () => {
  let targets: string[]
  let values: any[]
  let calldatas: string[]
  let descriptionHash: string
  let proposalId: string

  before(async () => {
    // Decode proposal from generated JSON
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const proposalJson = require(PROPOSAL_JSON)
    const iface = new ethers.utils.Interface([
      'function propose(address[] targets, uint256[] values, bytes[] calldatas, string description) returns (uint256)',
    ])
    const decoded = iface.decodeFunctionData('propose', proposalJson.transactions[0].data)
    // IMPORTANT: Use positional access — decoded.values collides with ethers Result.values()
    targets = Array.from(decoded[0])
    values = Array.from(decoded[1])
    calldatas = Array.from(decoded[2])
    descriptionHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(decoded[3]))

    const governor = await ethers.getContractAt('Governance', GOVERNOR)
    const main = await ethers.getContractAt('IMain', MAIN)
    const stRSR = await ethers.getContractAt('StRSRP1Votes', await main.stRSR())
    const rsr = await ethers.getContractAt('ERC20Mock', await main.rsr())
    const [tester] = await ethers.getSigners()

    // Verify JSON matches on-chain proposal
    proposalId = PROPOSAL_ID
    const pid = await governor.hashProposal(targets, values, calldatas, descriptionHash)
    expect(pid.toString()).to.equal(proposalId, 'JSON proposal does not match on-chain proposal')
    console.log(`On-chain proposal ${proposalId}`)

    const state = await governor.state(proposalId)
    console.log(`Current state: ${ProposalState[state]}`)

    // Stake RSR and delegate to vote the proposal through
    // For Base/Arbitrum where no RSR whale exists, replace with StRSR delegation
    const stakeAmount = (await stRSR.totalSupply()).mul(2)
    await whileImpersonating(hre, RSR_WHALE, async (signer) => {
      await rsr.connect(signer).transfer(tester.address, stakeAmount)
    })
    await rsr.connect(tester).approve(stRSR.address, stakeAmount)
    await stRSR.connect(tester).stake(stakeAmount)
    await stRSR.connect(tester).delegate(tester.address)
    await advanceBlocks(hre, 1)
    console.log(`Staked ${formatEther(stakeAmount)} RSR and delegated`)
  })

  it('should advance proposal through governance and execute', async () => {
    const governor = await ethers.getContractAt('Governance', GOVERNOR)
    const [tester] = await ethers.getSigners()

    let state = await governor.state(proposalId)
    console.log(`Initial state: ${ProposalState[state]}`)

    // Advance past voting delay
    // ADJUST for your governor type:
    //   Alexios (block-based):    advanceBlocks(hre, votingDelay.add(1))
    //   Anastasius (time-based):  advanceTime(hre, votingDelay.toNumber()) + advanceBlocks(hre, 2)
    //   Governance (time-based):  advanceTime(hre, votingDelay.toNumber()) + advanceBlocks(hre, 2)
    if (state == ProposalState.Pending) {
      const votingDelay = await governor.votingDelay()
      await advanceTime(hre, votingDelay.toNumber())
      await advanceBlocks(hre, 2)
      state = await governor.state(proposalId)
      console.log(`State after voting delay: ${ProposalState[state]}`)
    }

    // Cast vote
    if (state == ProposalState.Active) {
      await governor.connect(tester).castVote(proposalId, 1)
      console.log('Vote cast')

      const votingPeriod = await governor.votingPeriod()
      await advanceBlocks(hre, votingPeriod.add(1))
      state = await governor.state(proposalId)
      console.log(`State after voting period: ${ProposalState[state]}`)
    }

    // Queue
    if (state == ProposalState.Succeeded) {
      console.log('Proposal SUCCEEDED')
      await governor.queue(targets, values, calldatas, descriptionHash)
      state = await governor.state(proposalId)
      console.log('Proposal QUEUED')
    }

    // Execute
    if (state == ProposalState.Queued) {
      const timelock = await ethers.getContractAt('TimelockController', TIMELOCK)
      const minDelay = await timelock.getMinDelay()
      await advanceTime(hre, minDelay.add(1).toNumber())
      await advanceBlocks(hre, 1)

      await pushOraclesForward(hre, RTOKEN, [])

      const tx = await governor.execute(targets, values, calldatas, descriptionHash)
      const receipt = await tx.wait()
      console.log(`Proposal EXECUTED (gas: ${receipt.gasUsed})`)
    }

    expect(await governor.state(proposalId)).to.equal(ProposalState.Executed)
  })

  it('should have removed all roles', async () => {
    const main = await ethers.getContractAt('IMain', MAIN)

    for (const addr of PAUSERS) {
      expect(await main.hasRole(PAUSER_ROLE, addr)).to.equal(false)
    }
    expect(await main.hasRole(PAUSER_ROLE, TIMELOCK)).to.equal(false)
    console.log('All PAUSER roles removed')

    for (const addr of SHORT_FREEZERS) {
      expect(await main.hasRole(SHORT_FREEZER_ROLE, addr)).to.equal(false)
    }
    console.log('All SHORT_FREEZER roles removed')

    for (const addr of LONG_FREEZERS) {
      expect(await main.hasRole(LONG_FREEZER_ROLE, addr)).to.equal(false)
    }
    console.log('All LONG_FREEZER roles removed')

    expect(await main.hasRole(OWNER_ROLE, TIMELOCK)).to.equal(false)
    console.log('OWNER role removed from timelock')
  })

  it('should have paused issuance', async () => {
    const main = await ethers.getContractAt('IMain', MAIN)
    expect(await main.issuancePausedOrFrozen()).to.equal(true)
    console.log('Issuance is paused')
  })

  it('should have set batch auction length to 0', async () => {
    const broker = await ethers.getContractAt('BrokerP1', BROKER)
    expect(await broker.batchAuctionLength()).to.equal(0)
    console.log('Batch auction length is 0')
  })

  it('should still allow redemption', async () => {
    const rToken = await ethers.getContractAt('RTokenP1', RTOKEN)
    const main = await ethers.getContractAt('IMain', MAIN)
    const basketHandler = await ethers.getContractAt('BasketHandlerP1', await main.basketHandler())
    const assetRegistry = await ethers.getContractAt('AssetRegistryP1', await main.assetRegistry())

    await pushOraclesForward(hre, RTOKEN, [])
    await assetRegistry.refresh()

    const totalSupply = await rToken.totalSupply()
    console.log(`Total supply: ${formatEther(totalSupply)}`)

    const bal = await rToken.balanceOf(RTOKEN_HOLDER)
    expect(bal).to.be.gt(0)
    console.log(`Holder ${RTOKEN_HOLDER} has ${formatEther(bal)} RTokens`)

    await whileImpersonating(hre, RTOKEN_HOLDER, async (signer) => {
      // Cap redemption to avoid throttle on high-supply tokens
      const redeemAmt = bal.gt(fp('100')) ? fp('100') : bal

      const basketsNeeded = await rToken.basketsNeeded()
      const [erc20s] = await basketHandler['quote(uint192,uint8)'](
        redeemAmt.mul(basketsNeeded).div(totalSupply),
        0
      )

      const preBals: { [key: string]: any } = {}
      for (const erc20 of erc20s) {
        const token = await ethers.getContractAt('IERC20Metadata', erc20)
        preBals[erc20] = await token.balanceOf(signer.address)
      }

      console.log(`Redeeming ${formatEther(redeemAmt)}...`)
      await rToken.connect(signer).redeem(redeemAmt)

      for (const erc20 of erc20s) {
        const token = await ethers.getContractAt('IERC20Metadata', erc20)
        const received = (await token.balanceOf(signer.address)).sub(preBals[erc20])
        const symbol = await token.symbol()
        console.log(`  Received ${formatEther(received)} ${symbol}`)
        expect(received).to.be.gt(0)
      }

      console.log('Redemption successful!')
    })
  })

  it('should NOT allow new issuance', async () => {
    const rToken = await ethers.getContractAt('RTokenP1', RTOKEN)
    const [tester] = await ethers.getSigners()

    await expect(rToken.connect(tester).issue(fp('1'))).to.be.reverted
    console.log('Issuance correctly blocked')
  })

  it('should allow unstake and withdraw', async () => {
    const main = await ethers.getContractAt('IMain', MAIN)
    const stRSR = await ethers.getContractAt('StRSRP1Votes', await main.stRSR())
    const rsr = await ethers.getContractAt('ERC20Mock', await main.rsr())
    const [tester] = await ethers.getSigners()

    // Critical: verify trading is not paused (rgUSD/KNOX incident)
    expect(await main.tradingPausedOrFrozen()).to.equal(false)
    console.log('Trading is NOT paused — unstake/withdraw should work')

    const stRSRBal = await stRSR.balanceOf(tester.address)
    expect(stRSRBal).to.be.gt(0)
    console.log(`Tester StRSR balance: ${formatEther(stRSRBal)}`)

    const rsrBalBefore = await rsr.balanceOf(tester.address)
    await stRSR.connect(tester).unstake(stRSRBal)
    console.log('Unstake successful')

    const unstakingDelay = await stRSR.unstakingDelay()
    await advanceTime(hre, unstakingDelay + 1)
    await advanceBlocks(hre, 1)

    await pushOraclesForward(hre, RTOKEN, [])

    await stRSR.connect(tester).withdraw(tester.address, 1)
    const rsrBalAfter = await rsr.balanceOf(tester.address)
    expect(rsrBalAfter).to.be.gt(rsrBalBefore)
    console.log(`Withdrew ${formatEther(rsrBalAfter.sub(rsrBalBefore))} RSR`)
    console.log('Unstake and withdraw successful!')
  })
})
