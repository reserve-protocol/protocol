import fc from 'fast-check'
import { TokenModel } from './system0-model/TokenModel'
import { TokenCommands } from './system0-model/TokenCommands'
import { TokenCallerImplem } from './system1-evm/TokenCaller'
import { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { Contract } from 'ethers'

describe('Token Fuzz Test', () => {
  let token: Contract
  let minter: SignerWithAddress
  let recipient: SignerWithAddress
  let model: TokenModel

  let snapshotId: Number

  beforeEach(async function () {
    ;[minter, recipient] = await ethers.getSigners()

    const ERC20 = await ethers.getContractFactory('ERC20Mock')
    token = await ERC20.deploy('Token', 'TKN')

    // Instantiate Token lib Model
    model = new TokenModel()
  })

  it('Should run commands correctly', async function () {
    await fc.assert(
      fc
        .asyncProperty(TokenCommands, async (commands) => {
          const real = new TokenCallerImplem(token, minter, recipient)
          await fc.asyncModelRun(() => ({ model, real }), commands)
        })
        .beforeEach(async () => {
          snapshotId = await ethers.provider.send('evm_snapshot', [])
        })
        .afterEach(async () => {
          // Force rollback to reset
          await model.reset()
          await ethers.provider.send('evm_revert', [snapshotId])
        })
    )
  })
})
