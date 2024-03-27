import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'

import { bn, fp } from '../../common/numbers'
import { TestIFacade, TestIRToken } from '../../typechain'
import { IMPLEMENTATION, Implementation } from '../fixtures'
import { advanceBlocks } from './time'

// Issue `amount` RToken to `user`.
//
// Because hardhat_mine actually takes O(n) time to mine n
// blocks, we do this more cleverly than just one big issuance...
// This presumes that user has already granted allowances of basket tokens!
export async function issueMany(
  facade: TestIFacade,
  rToken: TestIRToken,
  toIssue: BigNumber,
  user: SignerWithAddress
): Promise<void> {
  const ISS_BLOCKS = bn(1e8) // How many blocks to wait between issuances; tweak to tune performance
  const MIN_ISSUANCE_RATE = fp(10000) // {rtoken / block}

  let issued = bn(0)
  const initBalance = await rToken.balanceOf(user.address)
  const issuanceRate = await rToken.issuanceRate()
  while (issued.lt(toIssue)) {
    // Find currIssue, the amount to issue this round
    const yetToIssue = toIssue.sub(issued)
    const baseAmt = MIN_ISSUANCE_RATE.mul(ISS_BLOCKS)
    const succAmt = (await rToken.totalSupply()).mul(issuanceRate).mul(ISS_BLOCKS).div(fp('1'))
    const maxAmt = baseAmt.gt(succAmt) ? baseAmt : succAmt
    const currIssue = maxAmt.lt(yetToIssue) ? maxAmt : yetToIssue

    // Issue currIssue to user, and wait ISS_BLOCKS
    await rToken.connect(user)['issue(uint256)'](currIssue)

    await advanceBlocks(ISS_BLOCKS.add(1))

    if (IMPLEMENTATION == Implementation.P1) {
      await rToken.vest(user.address, await facade.endIdForVest(rToken.address, user.address))
    } else if (IMPLEMENTATION == Implementation.P0) {
      const rTok = await ethers.getContractAt('RTokenP0', rToken.address)
      await rToken.vest(user.address, await rTok.endIdForVest(user.address))
    } else {
      throw new Error('Invalid impl type')
    }

    issued = issued.add(currIssue)
  }

  // assert that this worked
  expect(await rToken.balanceOf(user.address)).to.equal(initBalance.add(toIssue))
}
