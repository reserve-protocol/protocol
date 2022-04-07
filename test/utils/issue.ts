import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { bn, fp } from '../../common/numbers'
import { TestIRToken } from '../../typechain'
import { advanceBlocks } from './time'

// Issue `amount` RToken to `user`.
//
// Because hardhat_mine actually takes O(n) time to mine n
// blocks, we do this more cleverly than just one big issuance...
// This presumes that user has already granted allowances of basket tokens!
export async function issueMany(
  rToken: TestIRToken,
  toIssue: BigNumber,
  user: SignerWithAddress
): Promise<void> {
  const ISS_BLOCKS = bn(1e6) // How many blocks to wait between issuances; tweak to tune performance
  const MIN_ISSUANCE_RATE = fp(10000) // {rtoken / block}

  let supply = await rToken.totalSupply()
  let issued = bn(0)
  const initBalance = await rToken.balanceOf(user.address)
  const issuanceRate = await rToken.issuanceRate()

  while (issued.lt(toIssue)) {
    // Find currIssue, the amount to issue this round
    const yetToIssue = toIssue.sub(issued)
    const baseAmt = MIN_ISSUANCE_RATE.mul(ISS_BLOCKS)
    const succAmt = supply.mul(issuanceRate).mul(ISS_BLOCKS).div(fp('1'))
    const maxAmt = baseAmt.gt(succAmt) ? baseAmt : succAmt
    const currIssue = maxAmt.lt(yetToIssue) ? maxAmt : yetToIssue

    // Issue currIssue to user, and wait ISS_BLOCKS

    await rToken.connect(user).issue(currIssue)

    await advanceBlocks(ISS_BLOCKS.add(1))

    await rToken.vest(user.address, await rToken.endIdForVest(user.address))

    issued = issued.add(currIssue)
    supply = supply.add(currIssue)
  }

  // assert that this worked
  expect(await rToken.balanceOf(user.address)).to.equal(initBalance.add(toIssue))
  expect(await rToken.totalSupply()).to.equal(supply)
}
