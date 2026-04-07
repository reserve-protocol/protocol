import { expect } from 'chai'
import hre, { ethers } from 'hardhat'
import { whileImpersonating } from '#/utils/impersonation'
import { advanceBlocks, advanceTime } from '#/utils/time'
import { formatEther } from 'ethers/lib/utils'
import { bn, fp } from '#/common/numbers'
import { ProposalState } from '#/common/constants'
import { pushOraclesForward } from '../../tasks/validation/utils/oracles'

/**
 * Deprecation Proposal Validation — from JSON (pre-submission)
 *
 * Template for validating a deprecation proposal BEFORE it's submitted on-chain.
 * Decodes the proposal from the generated Safe TX Builder JSON, submits it via
 * the governor, advances through the governance lifecycle, and validates all
 * post-conditions including redemption and unstaking.
 *
 * === HOW TO ADAPT ===
 * 1. Set PROPOSAL_JSON to the path of your generated JSON
 * 2. Fill in the contract addresses (GOVERNOR, TIMELOCK, MAIN, RTOKEN, BROKER)
 * 3. Fill in role holders (PAUSERS, SHORT_FREEZERS, LONG_FREEZERS)
 * 4. Set RTOKEN_HOLDER to an address with RToken balance for redemption test
 * 5. Set RSR_WHALE or use StRSR delegation (see comments below)
 * 6. Adjust governor time advancement for your governor type (see below)
 *
 * === GOVERNOR TYPES ===
 * - Governance (Reserve):    time-based — advanceTime for delay, advanceBlocks for period
 * - Governor Anastasius:     time-based — advanceTime + advanceBlocks(2) for both
 * - Governor Alexios:        block-based — advanceBlocks for both
 *
 * === RUN ===
 *   PROTO=p1 FORK=1 FORK_NETWORK=<mainnet|base|arbitrum> FORK_BLOCK=<block> \
 *     npx hardhat test test/deprecation/deprecate-from-json.test.ts
 */

// ======================== CONFIGURE THESE ========================

const PROPOSAL_JSON = '../../scripts/deprecation/proposals/deprecate-USDCplus.json'

// Contract addresses
const GOVERNOR = '0xc837c557071d604bcb1058c8c4891ddbe8fdd630'
const TIMELOCK = '0x6c957417cb6df6e821eec8555dee8b116c291999'
const MAIN = '0xeC11Cf537497141aC820615F4f399be4a1638Af6'
const RTOKEN = '0xFc0B1EEf20e4c68B3DCF36c4537Cfa7Ce46CA70b'
const BROKER = '0x7aFc1d0bDFE2F3887466534516447bA4cE97B305'

// Role holders to verify removal (from generate-deprecation-proposals.py)
const PAUSERS = [
  '0x52ea58f4fc3ced48fa18e909226c1f8a0ef887dc',
  '0x8785b3a82d1e3c067cee8ff830df56c78f13526d',
  '0xfdefe2e8ae439547a4ca4b2656715e5bbceb295b',
]
const SHORT_FREEZERS = [
  '0x52ea58f4fc3ced48fa18e909226c1f8a0ef887dc',
  '0x8785b3a82d1e3c067cee8ff830df56c78f13526d',
  '0xfdefe2e8ae439547a4ca4b2656715e5bbceb295b',
]
const LONG_FREEZERS = [
  '0x52ea58f4fc3ced48fa18e909226c1f8a0ef887dc',
  '0x8785b3a82d1e3c067cee8ff830df56c78f13526d',
  '0xfdefe2e8ae439547a4ca4b2656715e5bbceb295b',
]

// RToken holder for redemption test — must have balance at the fork block
const RTOKEN_HOLDER = '0xf2b25362a03f6eacca8de8d5350a9f37944c1e59'

// RSR whale for staking voting power (mainnet only — for Base/Arbitrum use StRSR delegation)
const RSR_WHALE = '0x6bab6EB87Aa5a1e4A8310C73bDAAA8A5dAAd81C1'

// ======================== END CONFIG ========================

const PAUSER_ROLE = '0x5041555345520000000000000000000000000000000000000000000000000000'
const SHORT_FREEZER_ROLE =
  '0x53484f52545f465245455a455200000000000000000000000000000000000000'
const LONG_FREEZER_ROLE =
  '0x4c4f4e475f465245455a45520000000000000000000000000000000000000000'
const OWNER_ROLE = '0x4f574e4552000000000000000000000000000000000000000000000000000000'

describe('Deprecation Proposal (from JSON)', () => {
  let targets: string[]
  let values: any[]
  let calldatas: string[]
  let descriptionHash: string
  let proposalId: string

  before(async () => {
    // Decode proposal from generated JSON
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

    const pid = await governor.hashProposal(targets, values, calldatas, descriptionHash)
    proposalId = pid.toString()
    console.log(`Proposal ID: ${proposalId}`)

    // Get voting power: stake RSR and delegate
    // For Base/Arbitrum where no RSR whale exists, replace this block with
    // StRSR delegation from existing holders (see deprecate-rtoken.md skill)
    const stakeAmount = (await stRSR.totalSupply()).mul(2)
    await whileImpersonating(hre, RSR_WHALE, async (signer) => {
      await rsr.connect(signer).transfer(tester.address, stakeAmount)
    })
    await rsr.connect(tester).approve(stRSR.address, stakeAmount)
    await stRSR.connect(tester).stake(stakeAmount)
    await stRSR.connect(tester).delegate(tester.address)
    await advanceBlocks(hre, 1)
    console.log(`Staked ${formatEther(stakeAmount)} RSR and delegated`)

    // Submit proposal
    await governor.connect(tester).propose(targets, values, calldatas, decoded[3])
    console.log('Proposal submitted')
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
      await advanceBlocks(hre, votingDelay.add(1)) // Alexios (block-based)
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
    const basketHandler = await ethers.getContractAt(
      'BasketHandlerP1',
      await main.basketHandler()
    )
    const assetRegistry = await ethers.getContractAt(
      'AssetRegistryP1',
      await main.assetRegistry()
    )

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
